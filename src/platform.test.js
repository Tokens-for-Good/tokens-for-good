import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchedulePrompt, getAutomationInstructions } from './platform.js';
import { METHODOLOGY_VERSION, SCHEDULE_PROMPT_VERSION, readMethodology, methodologySteps } from './methodology.js';

// Prompt format v2: the scheduled routine must be self-contained. It embeds
// every pipeline step and never instructs the agent to fetch instructions
// from a URL — the legacy curl-loader pattern that tripped prompt-injection
// warnings on scheduled runs.

test('schedule prompt embeds all five methodology steps', () => {
  const prompt = getSchedulePrompt('tfg_live_test');
  for (const step of methodologySteps()) {
    const content = readMethodology(step);
    assert.ok(content && content.length > 100, `${step} methodology readable`);
    assert.ok(prompt.includes(content.slice(0, 80)), `${step} methodology embedded in prompt`);
  }
});

test('schedule prompt contains no runtime instruction fetches', () => {
  const prompt = getSchedulePrompt('tfg_live_test');
  assert.ok(!prompt.includes('/research/schedule-instructions'), 'no schedule-instructions fetch');
  assert.ok(!prompt.includes('/research/methodology'), 'no methodology fetch');
  assert.ok(prompt.includes('/research/parameters'), 'version handshake is the only extra call');
  assert.ok(prompt.includes('report_max_words'), 'fetched limits are applied as data');
});

test('schedule prompt stamps the embedded prompt version on submits', () => {
  const prompt = getSchedulePrompt('tfg_live_test');
  assert.ok(prompt.includes(`"prompt_version": "${SCHEDULE_PROMPT_VERSION}"`));
  assert.ok(SCHEDULE_PROMPT_VERSION.endsWith('-embed'));
  assert.ok(SCHEDULE_PROMPT_VERSION.length <= 20, 'fits the API column limit');
  assert.ok(prompt.includes(`methodology v${METHODOLOGY_VERSION}`));
});

test('schedule prompt documents the honest no-evidence path', () => {
  const prompt = getSchedulePrompt('tfg_live_test');
  assert.ok(prompt.includes('"no_evidence": true'));
  assert.ok(prompt.includes('never invent evidence'));
});

test('schedule prompt carries the API key and curl guidance', () => {
  const prompt = getSchedulePrompt('tfg_live_KEY123');
  assert.ok(prompt.includes('tfg_live_KEY123'));
  assert.ok(prompt.includes('X-TFG-Api-Key'));
  assert.ok(prompt.includes('WebFetch will NOT work'));
});

test('claude-code automation instructions wrap the embedded prompt', () => {
  const text = getAutomationInstructions('claude-code', 'daily', 'tfg_live_test', 2);
  assert.ok(text.includes('0 0,12 * * *'));
  assert.ok(text.includes('BEGIN RESEARCH METHODOLOGY'));
});
