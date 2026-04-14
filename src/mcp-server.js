#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ApiClient } from './api-client.js';
import { detectPlatform, isSchedulable, getAutomationInstructions } from './platform.js';
import { loadState, updateState, isSnoozed, snoozeDays, hasContributedToday, markContributed } from './state.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE_DIR = join(__dirname, '..', 'pipeline');
const PKG_VERSION = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')).version;

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
  version: '0.1.0',
});

// --- No-key onboarding message ---

const NO_KEY_INSTRUCTIONS = `This user has installed the Tokens for Good MCP server but hasn't set up their API key yet.

Walk them through setup:

1. **Create an account:** Go to https://fierce-philanthropy-directory.laravel.cloud/contribute and click "Sign up with GitHub" (one click, free).

2. **Copy the API key:** After signing up, they'll see an API key starting with \`tfg_live_\`. Copy it immediately -- it's only shown once.

3. **Add the key to their MCP config:** Update their tokens-for-good MCP configuration to include the key as an environment variable:

For Claude Code (.mcp.json or settings.json):
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

For Cursor (.cursor/mcp.json):
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

4. **Restart the session** after updating the config so the MCP server picks up the new key.

5. **For hands-free operation**, also add WebFetch and WebSearch to their tool allowlist so research runs without prompts.

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

Research pipeline (per org, all done by your AI):
- Research the org using web search + web fetch, following the 6-prompt methodology
- Score using a weighted checklist (100 pts base, 120 max with extra credit)
- Verify citations by visiting each URL before submitting
- Clean up writing style (no AI tells, no filler adjectives, no em dashes)

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

server.tool('claim_org', 'Claim the next available nonprofit org to research. Blocked if you have a pending peer review.', {
  platform: z.string().optional().describe('Your platform (claude-code, opencode, cursor, windsurf, devin)'),
}, async ({ platform: plat }) => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set. Get your key at https://fierce-philanthropy-directory.laravel.cloud/contribute' }] };

  try {
    const result = await client.claimOrg(plat || platform);
    return {
      content: [{ type: 'text', text: `Claimed: ${result.org.name}\nURL: ${result.org.url}\nDescription: ${result.org.description || 'N/A'}\nSource: ${result.org.source || 'N/A'}\nClaim ID: ${result.claim_id}\nExpires: ${result.expires_at}\n\nNext steps:\n1. Call get_methodology with step="research" to get the full research instructions\n2. Follow the methodology to research this org using WebSearch and WebFetch\n3. The methodology includes citation verification and writing quality checks — complete them before submitting\n4. Submit with submit_report when done` }],
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

server.tool('submit_report', 'Submit a completed research report for an org you claimed. You MUST include estimated_tokens.', {
  claim_id: z.string().describe('The claim ID from claim_org'),
  report_markdown: z.string().describe('The full research report in markdown'),
  estimated_tokens: z.number().describe('Estimated total tokens used: count web searches (~1K each), web fetches (~2-5K each), report output (~4 tokens/word), plus ~10K overhead'),
  model_used: z.string().optional().describe('The model that generated this report'),
}, async ({ claim_id, report_markdown, estimated_tokens, model_used }) => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };

  try {
    const result = await client.submitReport(claim_id, report_markdown, null, null, model_used, PKG_VERSION);
    markContributed();
    return {
      content: [{ type: 'text', text: `Report submitted for ${result.org_name}!\n\nYour stats:\n- Total orgs: ${result.contributor_stats.total_orgs}\n- Tier: ${result.contributor_stats.tier}\n- Orgs remaining: ${result.orgs_remaining}\n\nYour report will now go through peer review. Thank you for contributing!` }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: `Submit error: ${err.message}${err.data?.validation_errors ? '\n' + err.data.validation_errors.join('\n') : ''}` }] };
  }
});

server.tool('get_peer_review', 'Get a draft report assigned to you for peer review. You must complete peer reviews before claiming new orgs.', {}, async () => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };

  try {
    const result = await client.getNextPeerReview();
    let peerMethodology = '';
    try {
      peerMethodology = readFileSync(join(PIPELINE_DIR, '04-peer-review/PROMPT.md'), 'utf-8');
    } catch {
      peerMethodology = 'Score 1-4: 4=Great, 3=Good with fixes (submit corrected version), 2=Needs redo, 1=Bad actor.';
    }
    let factCheckNote = '';
    if (result.automated_review?.summary) {
      const s = result.automated_review.summary;
      const lines = [
        `\n\n## Automated Fact-Check Results`,
        `Quality: ${s.overall_quality} | Fact support: ${Math.round(s.fact_support_rate * 100)}% | Avg trust: ${Math.round(s.avg_trust_score * 100)}%`,
        `Facts checked: ${result.automated_review.facts_checked}/${result.automated_review.facts_extracted} | Citations rated: ${result.automated_review.citations_rated}`,
      ];
      if (s.red_flags?.length > 0) {
        lines.push(`\nRed flags:\n${s.red_flags.map(f => `  - ${f}`).join('\n')}`);
      }
      if (s.strengths?.length > 0) {
        lines.push(`\nStrengths:\n${s.strengths.map(f => `  - ${f}`).join('\n')}`);
      }
      lines.push(`\nUse these results to focus your spot-checks on flagged areas.`);
      factCheckNote = lines.join('\n');
    } else if (result.automated_review) {
      factCheckNote = `\n\nAutomated Fact-Check: ${result.automated_review.status} (no summary available yet)`;
    }
    return {
      content: [{ type: 'text', text: `Peer review assigned:\nOrg: ${result.org.name}\nAuthor: ${result.author}\nClaim ID: ${result.claim_id}${factCheckNote}\n\n---\n\n${peerMethodology}\n\n---\n\n${result.report_markdown}\n\n---\n\nUse submit_peer_review with your score and notes.` }],
    };
  } catch (err) {
    if (err.status === 404) {
      return { content: [{ type: 'text', text: 'No peer reviews assigned to you right now.' }] };
    }
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('submit_peer_review', 'Submit your peer review score for a report.', {
  claim_id: z.string().describe('The claim ID of the report being reviewed'),
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
    const estimatedCost = (c.total_tokens / 1_000_000 * 3).toFixed(2);

    return {
      content: [{ type: 'text', text: `Your Impact (@${c.github_handle}):\n\nTier: ${c.tier}\nOrgs researched: ${c.total_orgs}\nEstimated donation: ~$${estimatedCost}\nAcceptance rate: ${c.acceptance_rate}%\nAutomation: ${c.has_schedule ? 'Active' : 'Not set up'}\n\nRecent:\n${result.claims?.slice(0, 5).map(cl => `  ${cl.organization?.name || 'Unknown'} - ${cl.status}`).join('\n') || 'None'}` }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('setup_guide', 'Get setup instructions for Tokens for Good. Use this if the user needs help with installation, API keys, or configuration.', {}, async () => {
  return { content: [{ type: 'text', text: NO_KEY_INSTRUCTIONS }] };
});

server.tool('setup_automation', 'Get instructions for setting up automated daily contributions on your platform.', {
  frequency: z.enum(['hourly', 'daily', 'weekly']).optional().describe('How often to contribute'),
}, async ({ frequency }) => {
  const instructions = getAutomationInstructions(platform, frequency || 'daily');
  return { content: [{ type: 'text', text: instructions }] };
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
  if (client) {
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
  }

  if (isSnoozed()) {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'Tokens for Good is snoozed. No action needed.' } }] };
  }

  if (state.auto_schedule) {
    try {
      const impact = await client?.getImpact();
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

  // Show the session start prompt
  if (isSchedulable(platform)) {
    return {
      messages: [{
        role: 'user',
        content: { type: 'text', text: `Tokens for Good: Would you like to donate your spare tokens to research a nonprofit today?\n\n1. Set up automatic daily contributions (recommended)\n2. Just run one now\n3. Ask me tomorrow\n4. Ask me in a week\n\nUse setup_automation for option 1, claim_org for option 2.` },
      }],
    };
  } else {
    return {
      messages: [{
        role: 'user',
        content: { type: 'text', text: `Tokens for Good: Would you like to research a nonprofit org today? It takes about 5 minutes and costs ~$0.20 in tokens.\n\n1. Research an org now\n2. Ask me tomorrow\n3. Ask me in a week\n\nUse claim_org for option 1.` },
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
