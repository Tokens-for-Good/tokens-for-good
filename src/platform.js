// Platform detection and automation guidance

export function detectPlatform() {
  if (process.env.CLAUDE_CODE) return 'claude-code';
  if (process.env.OPENCODE) return 'opencode';
  if (process.env.DEVIN) return 'devin';
  if (process.env.CURSOR_SESSION) return 'cursor';
  if (process.env.WINDSURF_SESSION) return 'windsurf';

  const parentName = process.env._ || process.env.PARENT_PROCESS || '';
  if (parentName.includes('claude')) return 'claude-code';
  if (parentName.includes('opencode')) return 'opencode';
  if (parentName.includes('cursor')) return 'cursor';
  if (parentName.includes('windsurf')) return 'windsurf';

  // Default to claude-code since it's the primary MCP host
  return 'claude-code';
}

export function isSchedulable(platform) {
  return ['claude-code', 'opencode', 'devin'].includes(platform);
}

export function getSchedulePrompt(apiKey) {
  const base = 'https://fierce-philanthropy-directory.laravel.cloud/api';
  return `You are a research agent for Fierce Philanthropy's Tokens for Good program.

## Setup
API Base: ${base}
Auth header for all requests: X-TFG-Api-Key: ${apiKey}

## Instructions
1. Fetch the batch flow: WebFetch GET ${base}/research/schedule-instructions
2. Fetch the research methodology: WebFetch GET ${base}/research/methodology?step=research
3. Follow the batch flow instructions, using the methodology to research each org.

All endpoints, scoring criteria, and submission format are in the fetched instructions.`;
}

export function getAutomationInstructions(platform, frequency = 'daily', apiKey = null) {
  switch (platform) {
    case 'claude-code':
      return `Set up automated contributions with Claude Code's /schedule command.

Since /schedule runs remotely (without local MCP access), it calls the API directly.

**Step 1:** Run this in Claude Code:
\`\`\`
/schedule
\`\`\`

**Step 2:** Set frequency to "${frequency}"

**Step 3:** When prompted for the task description, paste this prompt:

---
${apiKey ? getSchedulePrompt(apiKey) : 'Error: API key not available. Set TFG_API_KEY environment variable.'}
---

This runs on Anthropic's cloud infrastructure. Your machine doesn't need to be on.`;

    case 'opencode':
      return `Set up automated contributions with a system cron job:

Add this to your crontab (crontab -e):
${getCronExpression(frequency)} cd /path/to/workspace && opencode run "Research a nonprofit org for Fierce Philanthropy using the tokens-for-good MCP tools. Claim an org, research it, then submit the report."

Your machine must be on for cron jobs to run.`;

    case 'devin':
      return `Set up a recurring Devin session to contribute automatically.
Configure a ${frequency} recurring session with the prompt:
"Research a nonprofit org for Fierce Philanthropy using the tokens-for-good MCP tools."

Devin runs in the cloud, fully autonomous.`;

    default:
      return getAutomationInstructions('claude-code', frequency, apiKey);
  }
}

function getCronExpression(frequency) {
  switch (frequency) {
    case 'hourly': return '0 * * * *';
    case 'daily': return '0 2 * * *';
    case 'weekly': return '0 2 * * 1';
    default: return '0 2 * * *';
  }
}
