#!/usr/bin/env node
// Ad-hoc tester for the live remote MCP at https://tokensforgood.ai/mcp.
// Usage: node scripts/mcp-call.mjs <tool_name> '<json-args>'
//   node scripts/mcp-call.mjs research_status
//   node scripts/mcp-call.mjs get_methodology '{"step":"research"}'
// Reads TFG_API_KEY from the project .env. Does the full Streamable-HTTP
// handshake (initialize -> notifications/initialized -> tools/call) each run.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(root, '.env'), 'utf8');
const KEY = (env.match(/^TFG_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) throw new Error('TFG_API_KEY not found in .env');

const URL = process.env.TFG_MCP_URL || 'https://tokensforgood.ai/mcp';
const [, , tool, argsJson] = process.argv;
const args = argsJson ? JSON.parse(argsJson) : {};

const baseHeaders = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'X-TFG-Api-Key': KEY,
};

// Laravel MCP replies as SSE (`data: {...}`) or plain JSON — grab the last JSON object either way.
function parse(text) {
  const lines = text.split('\n').map((l) => l.replace(/^data:\s?/, '').trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch {}
  }
  return { raw: text };
}

async function rpc(body, sid) {
  const headers = { ...baseHeaders };
  if (sid) headers['Mcp-Session-Id'] = sid;
  const res = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(body) });
  return { res, json: parse(await res.text()) };
}

const init = await rpc({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'adhoc', version: '0' } },
});
const sid = init.res.headers.get('mcp-session-id');
if (!tool) { console.log('initialize ->', init.res.status, JSON.stringify(init.json.result?.serverInfo)); process.exit(0); }

await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid);

const { res, json } = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } }, sid);
console.log(`HTTP ${res.status}  tool=${tool}`);
const r = json.result;
if (r?.content) {
  for (const c of r.content) console.log(c.type === 'text' ? c.text : JSON.stringify(c));
  if (r.isError) console.log('(isError: true)');
} else {
  console.log(JSON.stringify(json, null, 2));
}
