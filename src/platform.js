// Platform detection and automation guidance

export function detectPlatform() {
  // Check environment hints
  if (process.env.CLAUDE_CODE) return 'claude-code';
  if (process.env.OPENCODE) return 'opencode';
  if (process.env.DEVIN) return 'devin';
  if (process.env.CURSOR_SESSION) return 'cursor';
  if (process.env.WINDSURF_SESSION) return 'windsurf';

  // Check parent process name
  const parentName = process.env._ || process.env.PARENT_PROCESS || '';
  if (parentName.includes('claude')) return 'claude-code';
  if (parentName.includes('opencode')) return 'opencode';
  if (parentName.includes('cursor')) return 'cursor';
  if (parentName.includes('windsurf')) return 'windsurf';

  return 'unknown';
}

export function isSchedulable(platform) {
  return ['claude-code', 'opencode', 'devin'].includes(platform);
}

export function getAutomationInstructions(platform, frequency = 'daily') {
  switch (platform) {
    case 'claude-code':
      return `Set up automated contributions with Claude Code's built-in scheduling:

Run: /schedule ${frequency}

When prompted for the task, use:
"Research a nonprofit org for Fierce Philanthropy using the tokens-for-good MCP tools. Claim an org, research it, then submit the report."

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
      return `Automated contributions are not available on this platform. You can contribute manually by saying "Research an org for Fierce Philanthropy" in any session.`;
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
