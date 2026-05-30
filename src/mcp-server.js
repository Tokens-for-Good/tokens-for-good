#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ApiClient } from './api-client.js';
import { detectPlatform, isSchedulable, getAutomationInstructions } from './platform.js';
import { loadState, updateState, isSnoozed, snoozeDays, hasContributedToday, markContributed, markSetupComplete, getOrCreateInstallId } from './state.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE_DIR = join(__dirname, '..', 'pipeline');
const PKG_VERSION = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')).version;
const STATE_FILE = join(homedir(), '.tokens-for-good', 'state.json');

const INIT_GUARD_MESSAGE = `Tokens for Good setup isn't complete on this machine yet.

Tell the user to run this in their terminal (not here in the chat), then restart their AI tool:

  npx tokens-for-good init

The init command asks them to choose a contribution cadence (daily / weekly / one-off) and wires up everything else automatically. It takes about 30 seconds.`;

// Gate: only fires for genuinely cold installs where state.json is missing
// entirely. Existing users — including those on the pre-0.4.0 schema — pass
// through untouched. Init writes state.json on first successful completion,
// so after that this never fires again.
function notInitialized() {
  return !existsSync(STATE_FILE);
}

const apiKey = process.env.TFG_API_KEY;
const platform = detectPlatform();
updateState({ platform });
const installId = getOrCreateInstallId();

let client;
try {
  client = new ApiClient(apiKey, { version: PKG_VERSION, platform, installId });
} catch {
  // Will fail on tool calls, but server can still start
  client = null;
}

const server = new McpServer({
  name: 'tokens-for-good',
  version: PKG_VERSION,
});

// --- No-key onboarding message ---

const NO_KEY_INSTRUCTIONS = `The user wants to set up Tokens for Good. Tell them to run this in their terminal (not here in the chat), then restart their AI tool:

  npx tokens-for-good init

The command walks them through everything in under a minute:
1. Create an account at https://tokensforgood.ai/contribute (GitHub OAuth, free)
2. Copy their API key (starts with \`tfg_live_\`) and paste it into the init prompt
3. Pick a cadence: **daily** (recommended; choose how many runs per day), weekly, or one-off
4. Confirm

init writes everything — MCP config, SessionStart hook, /tfg and /tfg-schedule skills, and their recorded preference — in one shot. The first session after init runs their chosen flow automatically.

**What is Tokens for Good?** A way for developers to donate their spare AI subscription tokens to research nonprofit organizations for Fierce Philanthropy's social impact directory. Each org takes about 5 minutes. Contributors get credit on a public leaderboard.`;

// --- Resources ---

server.resource('about', 'tokens-for-good://about', 'text/plain', async () => ({
  contents: [{
    uri: 'tokens-for-good://about',
    text: `Tokens for Good - Donate Your Spare AI Tokens to Research Nonprofits

What: An MCP server that lets AI coding tool users (Claude Code, Opencode, Cursor, Windsurf, Devin) contribute their spare subscription tokens to research nonprofit organizations for Fierce Philanthropy's social impact directory.

How it works (v3 dual-research):
1. Sign up at https://tokensforgood.ai/contribute (GitHub OAuth)
2. Get your API key, add it to your MCP config as TFG_API_KEY
3. Say "Research an org for Fierce Philanthropy"
4. Your AI claims an org, researches it (web search + analysis), and submits a v3 report ending in an EVIDENCE TABLE
5. A second contributor (independently, without seeing your work) researches the same org and submits their own EVIDENCE TABLE
6. A third contributor consolidates both reports into one merged EVIDENCE TABLE; the server scores it deterministically
7. A human reviewer finalizes it for the directory

Research pipeline (per org, all done by your AI):
- Research the org using web search + web fetch, following the v3 EVIDENCE TABLE methodology
- Fill in an EVIDENCE TABLE (8 rows of verbatim quotes + real URLs); leave blanks honestly when the evidence doesn't exist
- The server (not you) computes the score deterministically from the merged consolidator output, out of 120
- Real URLs only — placeholder citations (example.com) are auto-rejected

Contributor tiers:
- New: first 5 orgs, easy orgs only
- Bronze: 5+ orgs
- Silver: 25+ orgs, >80% acceptance rate
- Gold: 100+ orgs, >90% acceptance rate

Automation: On Claude Code, use /schedule to auto-contribute daily. On Opencode, set up a system cron. On Cursor/Windsurf, contribute manually when prompted.

Scale: 750K+ US nonprofits to research.`,
  }],
}));

// --- Tools ---

server.tool('claim_org', 'Claim the next available nonprofit org to research. Blocked if you have a pending peer review.', {
  platform: z.string().optional().describe('Your platform (claude-code, opencode, cursor, windsurf, devin)'),
}, async ({ platform: plat }) => {
  if (notInitialized()) return { content: [{ type: 'text', text: INIT_GUARD_MESSAGE }] };
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set. Get your key at https://tokensforgood.ai/contribute' }] };

  try {
    const result = await client.claimOrg(plat || platform);
    return {
      content: [{ type: 'text', text: `Claimed: ${result.org.name} (${result.org.url})\nclaim_id: ${result.claim_id}\nexpires: ${result.expires_at}\nNext: get_methodology step="research", then submit_report.` }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('get_methodology', 'Get the full instructions for a pipeline step: research (the v3 EVIDENCE TABLE flow), verify, humanize, peer-review, or consolidate (the v3 dual-research merge step).', {
  step: z.enum(['research', 'verify', 'humanize', 'peer-review', 'consolidate']).describe('Which pipeline step to get instructions for'),
}, async ({ step }) => {
  const stepMap = {
    'research': '01-research/PROMPT.md',
    'verify': '02-verify/PROMPT.md',
    'humanize': '03-humanize/PROMPT.md',
    'peer-review': '04-peer-review/PROMPT.md',
    'consolidate': '05-consolidate/PROMPT.md',
  };

  try {
    const content = readFileSync(join(PIPELINE_DIR, stepMap[step]), 'utf-8');
    return { content: [{ type: 'text', text: content }] };
  } catch {
    return { content: [{ type: 'text', text: `Error: Could not load ${step} methodology file.` }] };
  }
});

server.tool('submit_report', 'Submit a completed research report (or a consolidated v3 report) for a claim you own. You MUST include estimated_tokens. For consolidation claims, also pass disagreement_rows.', {
  claim_id: z.string().describe('The claim ID from claim_org or get_next_consolidation'),
  report_markdown: z.string().describe('The full research report in markdown'),
  estimated_tokens: z.number().describe('Estimated total tokens used: count web searches (~1K each), web fetches (~2-5K each), report output (~4 tokens/word), plus ~10K overhead'),
  model_used: z.string().optional().describe('The model that generated this report'),
  prompt_version: z.string().optional().describe('Methodology version: "v3" for the EVIDENCE TABLE flow (default), "v2" for the legacy scorecard flow.'),
  disagreement_rows: z.array(z.enum(['a1', 'a2', 'a3', 'b', 'c', 'd', 'e', 'f'])).optional().describe('Consolidation-only: EVIDENCE TABLE row keys where the two researchers materially disagreed. >=3 auto-triggers a 3rd researcher.'),
}, async ({ claim_id, report_markdown, estimated_tokens, model_used, prompt_version, disagreement_rows }) => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };

  try {
    const result = await client.submitReport(claim_id, report_markdown, estimated_tokens, null, model_used, prompt_version, disagreement_rows);
    markContributed();

    // One-off users: first successful submit completes their initial setup,
    // so the SessionStart hook stops prompting from the next session onward.
    const state = loadState();
    if (state.intended_flow === 'one_off' && !state.first_setup_complete) {
      markSetupComplete();
    }

    return {
      content: [{ type: 'text', text: `Submitted: ${result.org_name}.` }],
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

server.tool('get_next_consolidation', 'Get your assigned v3 consolidation: the org plus both independent source reports to merge into one canonical EVIDENCE TABLE. Returns 204-style "no assignments" when nothing is queued for you.', {}, async () => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };

  try {
    const result = await client.getNextConsolidation();
    if (!result || !result.claim_id) {
      return { content: [{ type: 'text', text: 'No consolidations assigned to you right now.' }] };
    }
    let consolidateMethodology = '';
    try {
      consolidateMethodology = readFileSync(join(PIPELINE_DIR, '05-consolidate/PROMPT.md'), 'utf-8');
    } catch {
      consolidateMethodology = 'Merge the two source EVIDENCE TABLEs into one (take the stronger row from each; flag genuine disagreements). Submit with disagreement_rows.';
    }
    const reports = (result.source_reports || []).map((r, i) =>
      `### Source report ${i + 1} (submitted ${r.submitted_at || 'unknown'})\n\n${r.report_markdown}`
    ).join('\n\n---\n\n');
    return {
      content: [{ type: 'text', text: `Consolidation assigned:\nOrg: ${result.org?.name}\nRound: ${result.round_id}\nYour claim ID (submit against this one): ${result.claim_id}\n\n---\n\n${consolidateMethodology}\n\n---\n\n${reports}\n\n---\n\nWhen you submit the merged report with submit_report, include disagreement_rows.` }],
    };
  } catch (err) {
    if (err.status === 404 || err.status === 204) {
      return { content: [{ type: 'text', text: 'No consolidations assigned to you right now.' }] };
    }
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('submit_peer_review', 'Submit your peer review score for a report.', {
  claim_id: z.string().describe('The claim ID of the report being reviewed'),
  score: z.number().int().min(1).max(4).describe('Score: 4=great, 3=good with fixes, 2=needs redo, 1=bad actor'),
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
    const clientForStatus = client || new ApiClient('dummy', { version: PKG_VERSION, platform, installId }); // Status is public
    const result = await clientForStatus.getStatus();
    const sys = result.system_stats || result;
    const queue = result.queue_status || result.queue || {};
    const topList = result.top_contributors?.map((c, i) =>
      `${c.rank ?? i + 1}. ${c.display_name || (c.github_handle ? '@' + c.github_handle : 'anonymous')} (${c.total_organizations ?? c.total_orgs} orgs, ${c.tier})`
    ).join('\n') || 'No contributors yet';

    return {
      content: [{ type: 'text', text: `Tokens for Good Progress:\n\nTotal orgs: ${sys.total_organizations ?? result.total_orgs}\nPending research: ${sys.pending_organizations ?? result.pending_orgs}\nActive contributors (7d): ${sys.active_contributors_7_days ?? result.active_contributors_7d}\n\nQueue:\n${Object.entries(queue).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n\nTop Contributors:\n${topList}` }],
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

    // Older server builds omit github_handle from the impact response — fall
    // back to display_name so we never print "@undefined".
    const who = c.github_handle ? `@${c.github_handle}` : (c.display_name || 'you');
    return {
      content: [{ type: 'text', text: `Your Impact (${who}):\n\nTier: ${c.tier}\nOrgs researched: ${c.total_orgs}\nAcceptance rate: ${c.acceptance_rate}%\nAutomation: ${c.has_schedule ? 'Active' : 'Not set up'}\n\nRecent:\n${result.claims?.slice(0, 5).map(cl => `  ${cl.organization?.name || 'Unknown'} - ${cl.status}`).join('\n') || 'None'}` }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('setup_guide', 'Get setup instructions for Tokens for Good. Use this if the user needs help with installation, API keys, or configuration.', {}, async () => {
  return { content: [{ type: 'text', text: NO_KEY_INSTRUCTIONS }] };
});

server.tool('setup_automation', 'Get the scheduled-research prompt + setup instructions for the user\'s platform. Usually called by the /tfg-schedule skill (which extracts the prompt and invokes /schedule). Safe to call directly too — returns human-readable instructions.', {
  frequency: z.enum(['daily', 'weekly']).optional().describe('How often to contribute'),
  runs_per_day: z.number().int().min(1).max(15).optional().describe('For daily cadence: how many research runs per day (1-15). Defaults to 1.'),
}, async ({ frequency, runs_per_day }) => {
  if (notInitialized()) return { content: [{ type: 'text', text: INIT_GUARD_MESSAGE }] };
  const instructions = getAutomationInstructions(platform, frequency || 'daily', apiKey, runs_per_day || 1);
  return { content: [{ type: 'text', text: instructions }] };
});

server.tool('mark_setup_complete', 'Called by the /tfg-schedule skill after /schedule confirms, or by the /tfg skill after a successful first submission. Flips local state so the SessionStart hook stops emitting first-session instructions. Idempotent — safe to call multiple times.', {}, async () => {
  markSetupComplete();
  return { content: [{ type: 'text', text: 'Marked setup complete. The SessionStart hook will go silent from the next session.' }] };
});

server.tool('snooze', 'Snooze Tokens for Good reminders. Call this when the user says to remind them tomorrow, next week, or in N days.', {
  days: z.number().int().min(1).max(365).describe('Days to snooze (1 = tomorrow, 7 = next week)'),
}, async ({ days }) => {
  snoozeDays(days);
  return { content: [{ type: 'text', text: `Got it — Tokens for Good will stay quiet for ${days} day${days === 1 ? '' : 's'}.` }] };
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
    await client.getNextPeerReview();
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
        content: { type: 'text', text: `Tokens for Good: Would you like to donate your spare tokens to research a nonprofit today?\n\n1. Set up automatic daily contributions (recommended) — run /tfg-schedule\n2. Just run one now — run /tfg\n3. Ask me tomorrow\n4. Ask me in a week` },
      }],
    };
  } else {
    return {
      messages: [{
        role: 'user',
        content: { type: 'text', text: `Tokens for Good: Would you like to research a nonprofit org today? It takes about 5 minutes.\n\n1. Research an org now\n2. Ask me tomorrow\n3. Ask me in a week\n\nUse claim_org for option 1.` },
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
