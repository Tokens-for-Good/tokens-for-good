import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPlan, runPlanForAgent, runPlanPreviewForSetup, TOOL_STEERING } from './run-plan.js';
import { getSchedulePrompt } from './platform.js';

test('run plan names the claimed org and its url', () => {
  const plan = runPlan({ orgName: 'Evidence Action', orgUrl: 'https://evidenceaction.org' });
  assert.match(plan, /Evidence Action/);
  assert.match(plan, /https:\/\/evidenceaction\.org/);
});

test('run plan falls back to the queue when no org is claimed yet', () => {
  assert.match(runPlan(), /next organization in the Tokens for Good queue/);
});

test('run plan states what is read, sent, and never touched', () => {
  const plan = runPlan({ orgName: 'Example Org' });
  assert.match(plan, /\*\*Reads:\*\*/);
  assert.match(plan, /\*\*Sends back:\*\*/);
  assert.match(plan, /\*\*Never touches:\*\*/);
  for (const never of ['your files', 'other MCP servers', 'browser session', 'spends money']) {
    assert.ok(plan.includes(never), `run plan promises not to touch: ${never}`);
  }
});

test('the agent is told to show the plan and proceed, not to pause for approval', () => {
  const text = runPlanForAgent({ orgName: 'Example Org' });
  assert.match(text, /verbatim/);
  assert.match(text, /Do not wait for a confirmation/);
  assert.match(text, /not an approval gate/);
});

test('tool steering keeps the run on fetch and search, off browser automation', () => {
  assert.match(TOOL_STEERING, /web search and web fetch/);
  assert.match(TOOL_STEERING, /Do not open or drive a browser/);
  assert.ok(runPlanForAgent().includes(TOOL_STEERING), 'steering rides along with the plan');
});

test('setup preview reuses the same plan copy', () => {
  const preview = runPlanPreviewForSetup();
  assert.ok(preview.includes(runPlan()), 'no second copy of the plan wording');
  assert.match(preview, /no approval gate/);
});

test('the scheduled routine prompt carries the same plan and steering', () => {
  const prompt = getSchedulePrompt('tfg_live_test');
  assert.ok(prompt.includes(runPlan({ orgName: '<the org you just claimed>' })), 'plan embedded verbatim');
  assert.ok(prompt.includes(TOOL_STEERING), 'steering embedded verbatim');
  assert.match(prompt, /nobody is watching a scheduled run/);
});
