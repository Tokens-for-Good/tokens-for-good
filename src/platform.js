// Platform detection and automation guidance

export function detectPlatform() {
  if (process.env.CLAUDE_CODE) return 'claude-code';
  if (process.env.OPENCODE) return 'opencode';
  if (process.env.DEVIN) return 'devin';
  if (process.env.CURSOR_SESSION) return 'cursor';
  if (process.env.WINDSURF_SESSION) return 'windsurf';
  // Qwen Code doesn't reliably export a parent-identifying env var, so we
  // fall through to the parent-process heuristic for it.

  const parentName = process.env._ || process.env.PARENT_PROCESS || '';
  if (parentName.includes('claude')) return 'claude-code';
  if (parentName.includes('opencode')) return 'opencode';
  if (parentName.includes('cursor')) return 'cursor';
  if (parentName.includes('windsurf')) return 'windsurf';
  if (parentName.includes('qwen')) return 'qwen-code';

  // Default to claude-code since it's the primary MCP host
  return 'claude-code';
}

export function isSchedulable(platform) {
  return ['claude-code', 'opencode', 'devin', 'qwen-code'].includes(platform);
}

export function getSchedulePrompt(apiKey) {
  const base = 'https://tokensforgood.ai/api';
  return `You are a research agent for Fierce Philanthropy's Tokens for Good program.

## Setup
API Base: ${base}
Your API key: ${apiKey}

## Calling the API — read first
Use the **Bash tool with \`curl\`** for every authenticated ${base}/* call (next-action, claim, submit, consolidate). **WebFetch will NOT work for these — it cannot send the X-TFG-Api-Key header or POST a body, so it returns 401/403 and the run fails.** Always include \`-H "X-TFG-Api-Key: ${apiKey}"\`. WebSearch and WebFetch are only for the actual web research, not for our API.

## Instructions
1. Fetch the batch flow (public): \`curl -s "${base}/research/schedule-instructions"\`
2. Fetch the research methodology (public): \`curl -s "${base}/research/methodology?step=research"\`
3. Follow the batch-flow instructions. Use curl + the X-TFG-Api-Key header for every API call; use the methodology to research the org.

All endpoints, scoring criteria, and submission format are in the fetched instructions.`;
}

// Claude Code caps how many scheduled runs a routine gets per day, so daily
// research fires a chosen number of times (1-15).
export const MAX_RUNS_PER_DAY = 15;

export function getAutomationInstructions(platform, frequency = 'daily', apiKey = null, runsPerDay = 1) {
  const cron = cronForSchedule(frequency, runsPerDay);
  const label = scheduleLabel(frequency, runsPerDay);
  switch (platform) {
    case 'claude-code':
      return `Set up automated contributions with Claude Code's /schedule command.

(The /tfg-schedule skill does these 3 steps automatically. If you're reading this because Claude is orchestrating /tfg-schedule, extract the prompt between the --- markers and invoke /schedule on the schedule below with that prompt.)

**Step 1:** Run this in Claude Code:
\`\`\`
/schedule
\`\`\`

**Step 2:** Set the schedule to ${label} (cron: \`${cron}\`)

**Step 3:** When prompted for the task description, paste the prompt between the --- markers below:

---
${apiKey ? getSchedulePrompt(apiKey) : 'Error: API key not available. Set TFG_API_KEY environment variable.'}
---

This runs on Anthropic's cloud infrastructure. Your machine doesn't need to be on.`;

    case 'opencode':
      return `Set up automated contributions with a system cron job:

Add this to your crontab (crontab -e):
${cron} cd /path/to/workspace && opencode run "Research a nonprofit org for Fierce Philanthropy using the tokens-for-good MCP tools. Claim an org, research it, then submit the report."

Your machine must be on for cron jobs to run.`;

    case 'devin':
      return `Set up a recurring Devin session to contribute automatically.
Configure a ${label} recurring session with the prompt:
"Research a nonprofit org for Fierce Philanthropy using the tokens-for-good MCP tools."

Devin runs in the cloud, fully autonomous.`;

    case 'qwen-code':
      return `Set up automated contributions on Qwen Code.

Qwen Code v0.14+ has experimental built-in cron — enable it with QWEN_CODE_ENABLE_CRON=1 (or "experimental.cron": true in ~/.qwen/settings.json) and then use the Cron tool / /loop skill.

For a portable option, use a system cron job (add via crontab -e):
${cron} cd /path/to/workspace && qwen --prompt "Research a nonprofit org for Fierce Philanthropy using the tokens-for-good MCP tools. Claim an org, research it, then submit the report."

Your machine must stay on for system cron to run.`;

    default:
      return getAutomationInstructions('claude-code', frequency, apiKey, runsPerDay);
  }
}

// Build a cron expression. Weekly fires Monday 02:00. Daily fires `runsPerDay`
// times (1-15), evenly spaced across the day; once-daily fires at 02:00.
export function cronForSchedule(frequency, runsPerDay = 1) {
  if (frequency === 'weekly') return '0 2 * * 1';
  const n = clampRunsPerDay(runsPerDay);
  if (n === 1) return '0 2 * * *';
  const hours = Array.from({ length: n }, (_, i) => Math.round((i * 24) / n));
  return `0 ${hours.join(',')} * * *`;
}

function scheduleLabel(frequency, runsPerDay = 1) {
  if (frequency === 'weekly') return 'weekly (Mondays)';
  const n = clampRunsPerDay(runsPerDay);
  return n === 1 ? 'daily' : `${n}× per day`;
}

function clampRunsPerDay(runsPerDay) {
  return Math.min(MAX_RUNS_PER_DAY, Math.max(1, Math.floor(Number(runsPerDay)) || 1));
}
