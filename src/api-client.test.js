// Regression tests for ApiClient. The MCP layer passes `estimated_tokens` as
// a plain number; the Laravel API validates token_usage as `nullable|array`
// and reads `token_usage.total_tokens` for leaderboard accounting. If we
// stop normalizing the shape, every MCP submit silently 422s.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from './api-client.js';

function withMockFetch(fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return new Response(JSON.stringify({ success: true, org_name: 'Test' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return fn(calls).finally(() => {
    globalThis.fetch = original;
  });
}

test('submitReport wraps a numeric token_usage into {total_tokens: N}', async () => {
  await withMockFetch(async (calls) => {
    const client = new ApiClient('tfg_test_key');
    await client.submitReport('claim-uuid', 'report body', 12345);

    const body = JSON.parse(calls[0].opts.body);
    assert.deepEqual(
      body.token_usage,
      { total_tokens: 12345 },
      'numeric token usage must be wrapped so Laravel `nullable|array` accepts it'
    );
  });
});

test('submitReport passes an array-shaped token_usage through untouched', async () => {
  await withMockFetch(async (calls) => {
    const client = new ApiClient('tfg_test_key');
    const usage = { total_tokens: 42, input_tokens: 30, output_tokens: 12 };
    await client.submitReport('claim-uuid', 'report body', usage);

    const body = JSON.parse(calls[0].opts.body);
    assert.deepEqual(body.token_usage, usage);
  });
});

test('submitReport leaves null token_usage as null', async () => {
  await withMockFetch(async (calls) => {
    const client = new ApiClient('tfg_test_key');
    await client.submitReport('claim-uuid', 'report body', null);

    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.token_usage, null);
  });
});

test('submitReport forwards disagreement_rows and prompt_version', async () => {
  await withMockFetch(async (calls) => {
    const client = new ApiClient('tfg_test_key');
    await client.submitReport(
      'claim-uuid',
      'report body',
      100,
      null,
      'sonnet-4-6',
      'v3',
      ['a1', 'b']
    );

    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.prompt_version, 'v3');
    assert.deepEqual(body.disagreement_rows, ['a1', 'b']);
  });
});

test('enableSchedule POSTs to /research/enable-schedule (lights the dashboard badge)', async () => {
  await withMockFetch(async (calls) => {
    const client = new ApiClient('tfg_test_key');
    await client.enableSchedule();

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/research\/enable-schedule$/);
    assert.equal(calls[0].opts.method, 'POST');
  });
});

test('request() returns null on 204 No Content (consolidation queue empty)', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  try {
    const client = new ApiClient('tfg_test_key');
    const result = await client.getNextConsolidation();
    assert.equal(result, null);
  } finally {
    globalThis.fetch = original;
  }
});

test('setRolePreference posts a real boolean to the agent preferences endpoint', async () => {
  await withMockFetch(async (calls) => {
    const client = new ApiClient('tfg_test_key');
    await client.setRolePreference(true);

    assert.match(calls[0].url, /\/research\/agent\/preferences$/);
    assert.equal(JSON.parse(calls[0].opts.body).prefer_low_fetch_roles, true);
  });
});

test('createAgent posts label + low-fetch flag', async () => {
  await withMockFetch(async (calls) => {
    const client = new ApiClient('tfg_test_key');
    await client.createAgent('qwen-local', true);

    assert.match(calls[0].url, /\/research\/agents$/);
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.label, 'qwen-local');
    assert.equal(body.prefer_low_fetch_roles, true);
  });
});

test('rotateAgentKey + revokeAgent post the agent_id', async () => {
  await withMockFetch(async (calls) => {
    const client = new ApiClient('tfg_test_key');
    await client.rotateAgentKey(7);
    await client.revokeAgent(7);

    assert.match(calls[0].url, /\/research\/agents\/rotate$/);
    assert.equal(JSON.parse(calls[0].opts.body).agent_id, 7);
    assert.match(calls[1].url, /\/research\/agents\/revoke$/);
    assert.equal(JSON.parse(calls[1].opts.body).agent_id, 7);
  });
});

test('getNextValidation returns null on 204 (validation queue empty)', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  try {
    const client = new ApiClient('tfg_test_key');
    const result = await client.getNextValidation();
    assert.equal(result, null);
  } finally {
    globalThis.fetch = original;
  }
});

test('submitValidation posts validated_reports and wraps numeric token usage', async () => {
  await withMockFetch(async (calls) => {
    const client = new ApiClient('tfg_test_key');
    const validated = [{ claim_id: 'src-uuid', report_markdown: 'cleaned report' }];
    await client.submitValidation('val-uuid', validated, 'dropped row f', 5000);

    assert.match(calls[0].url, /\/research\/validate\/submit$/);
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.claim_id, 'val-uuid');
    assert.deepEqual(body.validated_reports, validated);
    assert.equal(body.validation_notes, 'dropped row f');
    assert.deepEqual(body.token_usage, { total_tokens: 5000 });
  });
});

// --- API base hardening ---
//
// FIERCE_API_URL used to be honoured with no scheme or host check, and fetch()
// followed redirects with X-TFG-Api-Key attached. Anything that can set an env
// var for the MCP process (a project's .claude/settings.json `env` block) could
// steer the key to an arbitrary host, over plaintext.

import { resolveBaseUrl, DEFAULT_BASE_URL } from './api-client.js';
import http from 'node:http';

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

test('the default base is used, with no warning, when FIERCE_API_URL is unset', () => {
  const warnings = [];
  assert.equal(resolveBaseUrl({}, w => warnings.push(w)), DEFAULT_BASE_URL);
  assert.deepEqual(warnings, []);
});

test('a plain-http, non-loopback FIERCE_API_URL is refused before the key can leave the process', async () => {
  await withEnv({ FIERCE_API_URL: 'http://10.99.99.99/api' }, () => withMockFetch(async (calls) => {
    assert.throws(() => new ApiClient('tfg_live_SECRET'), /only travels over https/);
    assert.equal(calls.length, 0);
  }));
});

test('plain http to a loopback address is allowed for local development', async () => {
  await withEnv({ FIERCE_API_URL: 'http://127.0.0.1:9/api/' }, () => {
    const client = new ApiClient('tfg_live_x');
    assert.equal(client.baseUrl, 'http://127.0.0.1:9/api');
    assert.equal(client.origin, 'http://127.0.0.1:9');
  });
  await withEnv({ FIERCE_API_URL: 'http://localhost:9/api' }, () => {
    assert.equal(new ApiClient('tfg_live_x').origin, 'http://localhost:9');
  });
});

test('an https override is allowed and announced on stderr', () => {
  const warnings = [];
  assert.equal(resolveBaseUrl({ FIERCE_API_URL: 'https://staging.example/api/' }, w => warnings.push(w)), 'https://staging.example/api');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /FIERCE_API_URL is set.*https:\/\/staging\.example/);
});

test('credentials, query strings, fragments and garbage in the base are refused', () => {
  for (const bad of ['https://user:pw@example.org/api', 'https://example.org/api?x=1', 'https://example.org/api#f', 'not a url', 'ftp://example.org/api']) {
    assert.throws(() => resolveBaseUrl({ FIERCE_API_URL: bad }, () => {}), new RegExp(bad === 'not a url' ? 'not a valid URL' : 'Refusing'));
  }
});

test('every request, keyed or public, refuses to follow redirects', async () => {
  await withMockFetch(async (calls) => {
    const client = new ApiClient('tfg_live_x');
    await client.getImpact();
    await client.getStatus();
    assert.equal(calls.length, 2);
    for (const c of calls) assert.equal(c.opts.redirect, 'error', `${c.url} must set redirect: 'error'`);
    assert.equal(calls[0].opts.headers['X-TFG-Api-Key'], 'tfg_live_x');
    assert.equal(calls[1].opts.headers['X-TFG-Api-Key'], undefined, 'status stays keyless');
  });
});

test('the key is never attached to a request whose origin differs from the configured base', async () => {
  await withMockFetch(async (calls) => {
    const client = new ApiClient('tfg_live_x');
    client.baseUrl = 'https://evil.example/api';
    await assert.rejects(client.getImpact(), /Refusing to call https:\/\/evil\.example/);
    assert.equal(calls.length, 0);
  });
});

function listen(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push({ path: req.url, key: req.headers['x-tfg-api-key'] });
    handler(req, res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ base: `http://127.0.0.1:${server.address().port}/api`, calls, close: () => new Promise(r => server.close(r)) });
  }));
}

test('a cross-origin redirect from the API is an error and the key never reaches the redirect target', async () => {
  const attacker = await listen((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
  const api = await listen((req, res) => { res.writeHead(302, { Location: `${attacker.base}/research/impact` }); res.end(); });
  try {
    await withEnv({ FIERCE_API_URL: api.base }, async () => {
      const client = new ApiClient('tfg_live_SECRET');
      await assert.rejects(client.getImpact());
      assert.equal(api.calls.length, 1, 'the API itself was called');
      assert.deepEqual(attacker.calls, [], 'nothing reached the redirect target');
    });
  } finally {
    await api.close();
    await attacker.close();
  }
});
