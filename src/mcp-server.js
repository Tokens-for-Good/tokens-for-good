#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ApiClient } from './api-client.js';
import { detectPlatform, isSchedulable, getAutomationInstructions } from './platform.js';
import { loadState, updateState, isSnoozed, hasContributedToday, markContributed, snoozeDays } from './state.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE_DIR = join(__dirname, '..', 'pipeline');

const apiKey = process.env.TFG_API_KEY;
let client;
try {
  client = new ApiClient(apiKey);
} catch {
  // Will fail on tool calls, but server can still start
  client = null;
}

const platform = detectPlatform();
updateState({ platform });

const server = new McpServer({
  name: 'tokens-for-good',
  version: '0.2.7',
});

// --- No-key onboarding message ---

const NO_KEY_INSTRUCTIONS = `This user has installed the Tokens for Good MCP server but hasn't set up their API key yet.

Walk them through setup:

1. **Create an account:** Go to https://fierce-philanthropy-directory.laravel.cloud/contribute and click "Sign up with GitHub" (one click, free).

2. **Copy the API key:** After signing up, they'll see an API key starting with \`tfg_live_\`. Copy it immediately -- it's only shown once.

3. **Add the key to their MCP config:** Update their tokens-for-good MCP configuration to include the key as an environment variable:

For Claude Code (create \`.mcp.json\` in your project root or home directory):

Mac/Linux:
\`\`\`json
{
  "mcpServers": {
    "tokens-for-good": {
      "command": "npx",
      "args": ["-y", "tokens-for-good", "--mcp"],
      "env": { "TFG_API_KEY": "tfg_live_their_key_here" }
    }
  }
}
\`\`\`

Windows:
\`\`\`json
{
  "mcpServers": {
    "tokens-for-good": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "tokens-for-good", "--mcp"],
      "env": { "TFG_API_KEY": "tfg_live_their_key_here" }
    }
  }
}
\`\`\`

For Opencode (opencode.json):
\`\`\`json
{
  "mcp": {
    "tokens-for-good": {
      "type": "local",
      "command": ["npx", "-y", "tokens-for-good", "--mcp"],
      "environment": { "TFG_API_KEY": "tfg_live_their_key_here" }
    }
  }
}
\`\`\`

For Cursor (\`.cursor/mcp.json\` in your project root):
\`\`\`json
{
  "mcpServers": {
    "tokens-for-good": {
      "command": "npx",
      "args": ["-y", "tokens-for-good", "--mcp"],
      "env": { "TFG_API_KEY": "tfg_live_their_key_here" }
    }
  }
}
\`\`\`

**Important:** Do NOT put MCP config in \`~/.claude/settings.json\` — Claude Code ignores MCP servers there. The \`.mcp.json\` file must be in your project root or home directory.

4. **Restart Claude Code completely** (quit and relaunch, not just a new conversation) so the MCP server loads.

5. **Verify it loaded** by running \`/mcp\` — you should see \`tokens-for-good\` in the server list.

6. **Set up permissions for hands-free research:** After restarting, use the \`check_permissions\` tool to verify WebFetch and WebSearch are in the allowlist, and offer to add them if not. Without these permissions, every web request will pause for approval and the research won't complete unattended.

Once set up, they can say "Research an org for Fierce Philanthropy" and the AI does the rest. Each org takes ~5 minutes and costs ~$0.20 in tokens.

**What is Tokens for Good?**
Tokens for Good lets developers donate their spare AI subscription tokens to research nonprofit organizations for Fierce Philanthropy's social impact directory. It's like Folding@Home but for AI tokens -- crowdsourced compute for social good. Contributors get credit on a public leaderboard and on the org pages they research.`;

// --- Resources ---

server.resource('about', 'tokens-for-good://about', 'text/plain', async () => ({
  contents: [{
    uri: 'tokens-for-good://about',
    text: `Tokens for Good - Donate Your Spare AI Tokens to Research Nonprofits

What: An MCP server that lets AI coding tool users (Claude Code, Opencode, Cursor, Windsurf, Devin) contribute their spare subscription tokens to research nonprofit organizations for Fierce Philanthropy's social impact directory.

How it works:
1. Sign up at https://fierce-philanthropy-directory.laravel.cloud/contribute (GitHub OAuth)
2. Get your API key, add it to your MCP config as TFG_API_KEY
3. Say "Research an org for Fierce Philanthropy"
4. Your AI claims an org, researches it (web search + analysis), verifies citations, humanizes the writing, and submits the report
5. Another contributor's AI peer-reviews your report
6. A human reviewer finalizes it for the directory

Research pipeline (3 steps per org, all done by your AI):
- Step 1: Research -- web search, 6-prompt methodology, scored checklist (100 pts)
- Step 2: Verify -- check every citation URL, flag hallucinations, correct errors
- Step 3: Humanize -- 9-pass AI decontamination (remove em dashes, filler adjectives, vary rhythm, inject analyst voice)

Contributor tiers:
- New: first 5 orgs, easy orgs only
- Bronze: 5+ orgs
- Silver: 25+ orgs, >80% acceptance rate
- Gold: 100+ orgs, >90% acceptance rate

Automation: On Claude Code, use /schedule to auto-contribute daily. On Opencode, set up a system cron. On Cursor/Windsurf, contribute manually when prompted.

Cost: ~$0.15-0.25 per org in tokens. Scale: 750K+ US nonprofits to research.`,
  }],
}));

// --- Tools ---

server.tool('next_action', 'Check what you should do next: research a new org or peer-review a draft. Call this before claim_org to maintain the 1:2 research-to-review ratio.', {}, async () => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };

  try {
    const result = await client.getNextAction();
    if (result.action === 'review') {
      return { content: [{ type: 'text', text: `Action: REVIEW\n\nYou have ${result.research_count} research submissions and ${result.review_count} peer reviews. Target ratio is 1:2 (research:review). Use get_peer_review to pick up a draft to review.` }] };
    }
    return { content: [{ type: 'text', text: `Action: RESEARCH\n\nYou have ${result.research_count} research submissions and ${result.review_count} peer reviews. You're clear to claim a new org. Use claim_org to get started.` }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('claim_org', 'Claim the next available nonprofit org to research. Call next_action first to check if you should review instead.', {
  platform: z.string().optional().describe('Your platform (claude-code, opencode, cursor, windsurf, devin)'),
}, async ({ platform: plat }) => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set. Get your key at https://fierce-philanthropy-directory.laravel.cloud/contribute' }] };

  try {
    const result = await client.claimOrg(plat || platform);
    return {
      content: [{ type: 'text', text: `Claimed: ${result.org.name}\nURL: ${result.org.url}\nDescription: ${result.org.description || 'N/A'}\nSource: ${result.org.source || 'N/A'}\nClaim ID: ${result.claim_id}\nExpires: ${result.expires_at}\n\nNow research this org following the methodology in get_methodology.` }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('get_methodology', 'Get the full research methodology, verification instructions, or humanization instructions.', {
  step: z.enum(['research', 'verify', 'humanize', 'peer-review']).describe('Which pipeline step to get instructions for'),
}, async ({ step }) => {
  const stepMap = {
    'research': '01-research/PROMPT.md',
    'verify': '02-verify/PROMPT.md',
    'humanize': '03-humanize/PROMPT.md',
    'peer-review': '04-peer-review/PROMPT.md',
  };

  try {
    const content = readFileSync(join(PIPELINE_DIR, stepMap[step]), 'utf-8');
    return { content: [{ type: 'text', text: content }] };
  } catch {
    return { content: [{ type: 'text', text: `Error: Could not load ${step} methodology file.` }] };
  }
});

server.tool('submit_report', 'Submit a completed research report for an org you claimed. You MUST include estimated_tokens — count your web searches (each ~1K tokens), web fetches (each ~2-5K tokens), and your output (~4 tokens per word of report). Add it all up.', {
  claim_id: z.number().describe('The claim ID from claim_org'),
  report_markdown: z.string().describe('The full research report in markdown'),
  model_used: z.string().optional().describe('The model that generated this report'),
  estimated_tokens: z.number().describe('Estimated total tokens: count web searches (~1K each), web fetches (~2-5K each), your report output (~4 tokens/word), plus ~10K for system prompts and tool calls'),
}, async ({ claim_id, report_markdown, model_used, estimated_tokens }) => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };

  const tokenUsage = estimated_tokens ? { total_tokens: estimated_tokens } : null;
  try {
    const result = await client.submitReport(claim_id, report_markdown, tokenUsage, null, model_used);
    markContributed();
    const state = loadState();
    const stats = result.contributor_stats;

    let message = `Report submitted for ${result.org_name}!\n\nYour stats:\n- Total orgs: ${stats.total_orgs}\n- Tier: ${stats.tier}\n- Orgs remaining: ${result.orgs_remaining}\n\nYour report will now go through peer review. Thank you for contributing!`;

    // Nudge to set up automation if they haven't already
    if (!state.auto_schedule) {
      if (isSchedulable(platform)) {
        message += `\n\n---\n\nWant to make this automatic? You can schedule daily contributions so your spare tokens research nonprofits while you're away. Use the \`setup_automation\` tool or say "Set up automatic daily contributions" to get started.`;
      } else {
        message += `\n\n---\n\nWant to contribute regularly? You can set up a system cron to research an org automatically each day. Use the \`setup_automation\` tool to get instructions for your platform.`;
      }
    }

    return { content: [{ type: 'text', text: message }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Submit error: ${err.message}${err.data?.validation_errors ? '\n' + err.data.validation_errors.join('\n') : ''}` }] };
  }
});

server.tool('get_peer_review', 'Get a draft report assigned to you for peer review. You must complete peer reviews before claiming new orgs.', {}, async () => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };

  try {
    const result = await client.getNextPeerReview();
    return {
      content: [{ type: 'text', text: `Peer review assigned:\nOrg: ${result.org.name}\nAuthor: @${result.author}\nClaim ID: ${result.claim_id}\n\n---\n\n${result.report_markdown}\n\n---\n\nReview this report. Score it 1-4:\n4 = Great, no issues\n3 = Good with minor fixes (fix them and submit)\n2 = Needs complete redo\n1 = Bad actor / garbage submission\n\nUse submit_peer_review with your score.` }],
    };
  } catch (err) {
    if (err.status === 404) {
      return { content: [{ type: 'text', text: 'No peer reviews assigned to you right now.' }] };
    }
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('submit_peer_review', 'Submit your peer review score for a report.', {
  claim_id: z.number().describe('The claim ID of the report being reviewed'),
  score: z.number().min(1).max(4).describe('Score: 4=great, 3=good with fixes, 2=needs redo, 1=bad actor'),
  notes: z.string().optional().describe('Review notes explaining the score'),
  updated_report: z.string().optional().describe('If score is 3, the fixed version of the report'),
}, async ({ claim_id, score, notes, updated_report }) => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };

  try {
    const result = await client.submitPeerReview(claim_id, score, notes, updated_report);
    return {
      content: [{ type: 'text', text: `Peer review submitted for ${result.org_name}.\nScore: ${result.score}/4\n\nYou can now claim a new org to research.` }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('research_status', 'See the overall Tokens for Good project progress and leaderboard.', {}, async () => {
  try {
    const clientForStatus = client || new ApiClient('dummy'); // Status is public
    const result = await clientForStatus.getStatus();
    const topList = result.top_contributors?.map((c, i) =>
      `${i + 1}. @${c.github_handle} (${c.total_orgs} orgs, ${c.tier})`
    ).join('\n') || 'No contributors yet';

    return {
      content: [{ type: 'text', text: `Tokens for Good Progress:\n\nTotal orgs: ${result.total_orgs}\nPending research: ${result.pending_orgs}\nActive contributors (7d): ${result.active_contributors_7d}\n\nQueue:\n${Object.entries(result.queue || {}).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n\nTop Contributors:\n${topList}` }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('my_impact', 'See your personal contribution stats, tier, and history.', {}, async () => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };

  try {
    const result = await client.getImpact();
    const c = result.contributor;
    const tokenStr = c.total_tokens > 0 ? `${(c.total_tokens / 1000).toFixed(0)}K tokens contributed` : 'No token data yet';

    return {
      content: [{ type: 'text', text: `Your Impact (@${c.github_handle}):\n\nTier: ${c.tier}\nOrgs researched: ${c.total_orgs}\nTokens: ${tokenStr}\nAcceptance rate: ${c.acceptance_rate}%\nAutomation: ${c.has_schedule ? 'Active' : 'Not set up'}\n\nRecent:\n${result.claims?.slice(0, 5).map(cl => `  ${cl.organization?.name || 'Unknown'} - ${cl.status}`).join('\n') || 'None'}` }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('get_badge', 'Get a markdown badge for your GitHub README showing your Tokens for Good contribution stats.', {}, async () => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };

  try {
    const result = await client.getImpact();
    const c = result.contributor;
    const tier = c.tier || 'new';
    const orgCount = c.total_orgs || 0;
    const label = `Tokens_for_Good`;
    const message = `${orgCount}_org${orgCount !== 1 ? 's' : ''}_researched`;
    const color = tier === 'gold' ? 'FFD700' : tier === 'silver' ? 'C0C0C0' : tier === 'bronze' ? 'CD7F32' : '54BC4B';
    const badgeUrl = `https://img.shields.io/badge/${label}-${message}-${color}?style=flat`;
    const linkUrl = `https://fierce-philanthropy-directory.laravel.cloud/contribute`;
    const markdown = `[![Tokens for Good](${badgeUrl})](${linkUrl})`;

    return {
      content: [{ type: 'text', text: `Add this badge to your GitHub README:\n\n\`\`\`markdown\n${markdown}\n\`\`\`\n\nPreview: ${markdown}\n\nTier: ${tier} | Orgs: ${orgCount}` }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('setup_guide', 'Get setup instructions for Tokens for Good. Use this if the user needs help with installation, API keys, or configuration.', {}, async () => {
  return { content: [{ type: 'text', text: NO_KEY_INSTRUCTIONS }] };
});

server.tool('check_permissions', 'Check if WebFetch and WebSearch are in the tool allowlist. If not, offer to add them. Call this after setup or before first research run.', {}, async () => {
  // We can't read the settings file directly, but we can tell the AI what to do
  return {
    content: [{ type: 'text', text: `Check if this user's Claude Code has WebFetch and WebSearch in their tool allowlist. To do this:

1. Read the file ~/.claude/settings.json
2. Look for the "permissions.allow" array
3. Check if it contains ALL of these required entries:
   - "WebFetch" (fetching org websites, reports, PDFs)
   - "WebSearch" (searching for evidence, evaluations, third-party reviews)
   - "mcp__tokens-for-good__*" (all Tokens for Good MCP tools — claim, submit, methodology, etc.)

If ALL THREE are already present, tell the user they're all set for hands-free research.

If any are MISSING, explain:
"Tokens for Good needs these permissions to research nonprofits without pausing for approval on every action. Can I add them to your allowlist?"

Then list what's missing and what each one does.

If they agree, edit ~/.claude/settings.json to add the missing entries to the "permissions.allow" array. For example:
{
  "permissions": {
    "allow": [
      "WebFetch",
      "WebSearch",
      "mcp__tokens-for-good__*"
    ]
  }
}

Merge with any existing entries — don't overwrite other allowed tools.

After adding, tell them: "Done! Research will now run hands-free. Try saying 'Research an org for Fierce Philanthropy' to get started."` }],
  };
});

server.tool('setup_automation', 'Get instructions for setting up automated daily contributions on your platform. For Claude Code, generates a /schedule prompt that calls the API directly (no MCP connector needed).', {
  frequency: z.enum(['hourly', 'daily', 'weekly']).optional().describe('How often to contribute'),
}, async ({ frequency }) => {
  const instructions = getAutomationInstructions(platform, frequency || 'daily', apiKey);
  return { content: [{ type: 'text', text: instructions }] };
});

server.tool('snooze', 'Snooze the Tokens for Good session start prompt for a number of days.', {
  days: z.number().min(1).max(30).describe('Number of days to snooze (1 = ask tomorrow, 7 = ask in a week)'),
}, async ({ days }) => {
  snoozeDays(days);
  return { content: [{ type: 'text', text: `Got it! Tokens for Good will stay quiet for ${days} day${days !== 1 ? 's' : ''}.` }] };
});

// --- Prompts (session start) ---

server.prompt('session_start', 'Check if you should research an org or complete a peer review', {}, async () => {
  // No API key -- guide through setup
  if (!client) {
    return {
      messages: [{
        role: 'user',
        content: { type: 'text', text: NO_KEY_INSTRUCTIONS },
      }],
    };
  }

  const state = loadState();

  // Check for pending peer review first
  try {
      const review = await client.getNextPeerReview();
      return {
        messages: [{
          role: 'user',
          content: { type: 'text', text: `You have a pending peer review to complete before you can claim a new org. Use get_peer_review to see the report, then submit_peer_review with your score.` },
        }],
      };
    } catch {
      // No pending review, continue
    }

  if (isSnoozed()) {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'Tokens for Good is snoozed. No action needed.' } }] };
  }

  if (state.auto_schedule) {
    try {
      const impact = await client.getImpact();
      const c = impact?.contributor;
      return {
        messages: [{
          role: 'user',
          content: { type: 'text', text: `Tokens for Good: You're auto-contributing. ${c?.total_orgs || 0} orgs researched so far. Tier: ${c?.tier || 'new'}.` },
        }],
      };
    } catch {
      return { messages: [{ role: 'user', content: { type: 'text', text: 'Tokens for Good: Auto-contributions active.' } }] };
    }
  }

  if (hasContributedToday()) {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'Tokens for Good: You already contributed today. Nice work!' } }] };
  }

  // Check permissions before first research
  const permNote = state.total_session_contributions === 0
    ? `\n\n**First time?** Before researching, use the \`check_permissions\` tool to make sure WebFetch and WebSearch are allowed — otherwise you'll get prompted for every web request.`
    : '';

  // Show the session start prompt
  if (isSchedulable(platform)) {
    return {
      messages: [{
        role: 'user',
        content: { type: 'text', text: `Tokens for Good: Would you like to donate your spare tokens to research a nonprofit today?\n\n1. Set up automatic daily contributions (recommended)\n2. Just run one now\n3. Ask me tomorrow\n4. Ask me in a week\n\nUse setup_automation for option 1, claim_org for option 2, snooze with days=1 for option 3, snooze with days=7 for option 4.${permNote}` },
      }],
    };
  } else {
    return {
      messages: [{
        role: 'user',
        content: { type: 'text', text: `Tokens for Good: Would you like to research a nonprofit org today? It takes about 5 minutes.\n\n1. Research an org now\n2. Ask me tomorrow\n3. Ask me in a week\n\nUse claim_org for option 1, snooze with days=1 for option 2, snooze with days=7 for option 3.${permNote}` },
      }],
    };
  }
});

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
