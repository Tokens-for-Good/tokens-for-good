#!/usr/bin/env node

// CLI entry point for tokens-for-good.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const HELP = `tokens-for-good v${pkg.version}
Contribute your spare AI tokens to research nonprofits for Fierce Philanthropy.

Usage:
  npx tokens-for-good <command> [options]

Commands:
  init                  Interactive first-time setup (API key, causes, cadence)
  session-start-hook    Emit the SessionStart hook payload (used by your agent)
  status                Show project-wide research stats
  impact                Show your own contribution stats (needs TFG_API_KEY)

Options:
  --status              Same as the "status" command
  --impact              Same as the "impact" command
  -v, --version         Print the installed version
  -h, --help            Show this help

With no command (or --mcp), tokens-for-good starts as an MCP server over
stdio. That is how your editor's MCP client launches it.

Docs: https://github.com/Tokens-for-Good/tokens-for-good`;

const args = process.argv.slice(2);
const first = args[0];

if (args.includes('-v') || args.includes('--version')) {
  console.log(pkg.version);
} else if (args.includes('-h') || args.includes('--help') || first === 'help') {
  console.log(HELP);
} else if (first === 'init') {
  const { runInit } = await import('./init.js');
  await runInit();
} else if (first === 'session-start-hook') {
  const { runSessionStartHook } = await import('./session-start-hook.js');
  runSessionStartHook();
} else if (args.includes('--status') || first === 'status') {
  const { ApiClient } = await import('./api-client.js');
  const { getOrCreateInstallId } = await import('./state.js');
  const { cleanText: t } = await import('./untrusted.js');
  try {
    const client = new ApiClient(process.env.TFG_API_KEY || 'public', { version: pkg.version, installId: getOrCreateInstallId() });
    const status = await client.getStatus();
    console.log('\nTokens for Good - Project Status\n');
    console.log(`Total orgs: ${t(status.total_orgs ?? 'n/a', 20)}`);
    console.log(`Pending research: ${t(status.pending_orgs ?? 'n/a', 20)}`);
    console.log(`Active contributors (7d): ${t(status.active_contributors_7d ?? 'n/a', 20)}`);
    console.log('\nQueue:');
    for (const [k, v] of Object.entries(status.queue || {})) {
      console.log(`  ${t(k, 40)}: ${t(v, 20)}`);
    }
    console.log('\nTop Contributors:');
    (status.top_contributors || []).forEach((c, i) => {
      const name = t(c.display_name || 'anonymous', 50);
      console.log(`  ${i + 1}. ${name} (${t(c.total_orgs, 20)} orgs, ${t(c.tier, 20)})`);
    });
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  }
} else if (args.includes('--impact') || first === 'impact') {
  const { ApiClient } = await import('./api-client.js');
  const { getOrCreateInstallId } = await import('./state.js');
  const { cleanText: t } = await import('./untrusted.js');
  try {
    const client = new ApiClient(process.env.TFG_API_KEY, { version: pkg.version, installId: getOrCreateInstallId() });
    const result = await client.getImpact();
    const c = result?.contributor || {};
    console.log(`\nYour Impact (${t(c.github_handle ? '@' + c.github_handle : (c.display_name || 'you'), 60)})\n`);
    console.log(`Tier: ${t(c.tier, 20)}`);
    console.log(`Orgs researched: ${t(c.total_orgs, 20)}`);
    console.log(`Acceptance rate: ${t(c.acceptance_rate, 20)}%`);
    console.log(`Automation: ${c.has_schedule ? 'Active' : 'Not set up'}`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  }
} else if (args.length === 0 || args.includes('--mcp')) {
  // Default: start the MCP server. This is how the editor's MCP client launches us
  // (init writes the config with the --mcp flag).
  await import('./mcp-server.js');
} else {
  // Unrecognized command/flag: show help instead of silently starting the server.
  console.error(`Unknown command: ${args.join(' ')}\n`);
  console.log(HELP);
  process.exitCode = 1;
}
