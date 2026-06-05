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
