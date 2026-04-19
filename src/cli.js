#!/usr/bin/env node

// CLI entry point for tokens-for-good.
// Usage:
//   npx tokens-for-good init                  Interactive first-time setup
//   npx tokens-for-good session-start-hook    SessionStart hook (used by Claude Code)
//   npx tokens-for-good --mcp                 Start as MCP server (default)
//   npx tokens-for-good --status              Show project status
//   npx tokens-for-good --impact              Show your contribution stats

const args = process.argv.slice(2);
const first = args[0];

if (first === 'init') {
  const { runInit } = await import('./init.js');
  await runInit();
} else if (first === 'session-start-hook') {
  const { runSessionStartHook } = await import('./session-start-hook.js');
  runSessionStartHook();
} else if (args.includes('--status') || first === 'status') {
  const { ApiClient } = await import('./api-client.js');
  try {
    const client = new ApiClient(process.env.TFG_API_KEY || 'public');
    const status = await client.getStatus();
    console.log('\nTokens for Good - Project Status\n');
    console.log(`Total orgs: ${status.total_orgs}`);
    console.log(`Pending research: ${status.pending_orgs}`);
    console.log(`Active contributors (7d): ${status.active_contributors_7d}`);
    console.log('\nQueue:');
    for (const [k, v] of Object.entries(status.queue || {})) {
      console.log(`  ${k}: ${v}`);
    }
    console.log('\nTop Contributors:');
    (status.top_contributors || []).forEach((c, i) => {
      console.log(`  ${i + 1}. @${c.github_handle} (${c.total_orgs} orgs, ${c.tier})`);
    });
  } catch (err) {
    console.error('Error:', err.message);
  }
} else if (args.includes('--impact') || first === 'impact') {
  const { ApiClient } = await import('./api-client.js');
  try {
    const client = new ApiClient(process.env.TFG_API_KEY);
    const result = await client.getImpact();
    const c = result.contributor;
    console.log(`\nYour Impact (@${c.github_handle})\n`);
    console.log(`Tier: ${c.tier}`);
    console.log(`Orgs researched: ${c.total_orgs}`);
    console.log(`Acceptance rate: ${c.acceptance_rate}%`);
    console.log(`Automation: ${c.has_schedule ? 'Active' : 'Not set up'}`);
  } catch (err) {
    console.error('Error:', err.message);
  }
} else {
  // Default: start MCP server
  await import('./mcp-server.js');
}
