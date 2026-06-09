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

server.tool('claim_org', 'Claim the next available nonprofit org to research.', {
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
    // 409 means you already have an active claim — usually an auto-assigned
    // 3rd-researcher slot you were handed without asking. Surface the existing
    // org + claim_id so the agent can continue the assigned task instead of
    // bouncing off "you have a claim" with no idea which one.
    const existing = err.data?.existing_claim;
    if (err.status === 409 && existing?.org) {
      return {
        content: [{ type: 'text', text: `You're already assigned: ${existing.org.name} (${existing.org.url})\nclaim_id: ${existing.claim_id}\nNext: get_methodology step="research", then submit_report against that claim_id.` }],
      };
    }
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('get_methodology', 'Get the full instructions for a pipeline step: research (the v3 EVIDENCE TABLE flow), verify, humanize, validate (prune unsupported evidence from two reports using cached page text), or consolidate (the v3 dual-research merge step).', {
  step: z.enum(['research', 'verify', 'humanize', 'validate', 'consolidate']).describe('Which pipeline step to get instructions for'),
}, async ({ step }) => {
  const stepMap = {
    'research': '01-research/PROMPT.md',
    'verify': '02-verify/PROMPT.md',
    'humanize': '03-humanize/PROMPT.md',
    'validate': '04-validate/PROMPT.md',
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

server.tool('get_next_validation', 'Get your assigned v3 validation: both researchers\' reports, the server\'s deterministic citation verdicts, and the cached text of every page they cite. You validate using ONLY that cached text (no web fetches), pruning unsupported/fabricated EVIDENCE TABLE rows. Returns "no assignments" when nothing is queued for you.', {}, async () => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };

  try {
    const result = await client.getNextValidation();
    if (!result || !result.claim_id) {
      return { content: [{ type: 'text', text: 'No validations assigned to you right now.' }] };
    }
    let validateMethodology = '';
    try {
      validateMethodology = readFileSync(join(PIPELINE_DIR, '04-validate/PROMPT.md'), 'utf-8');
    } catch {
      validateMethodology = 'Using ONLY the cached page text provided, remove EVIDENCE TABLE rows whose quote is not on its cited page (verdict "fabricated"), and correct quotes that do not match. You may only SUBTRACT or CORRECT-to-source, never ADD. Submit the corrected reports with submit_validation.';
    }
    const reports = (result.source_reports || []).map((r, i) =>
      `### Source report ${i + 1} — claim_id ${r.claim_id} (submitted ${r.submitted_at || 'unknown'})\n\nServer citation verdicts: ${JSON.stringify(r.citation_verdicts || {})}\n\n${r.report_markdown}`
    ).join('\n\n---\n\n');
    const pages = (result.cached_pages || []).map((p) =>
      `#### ${p.url}  [${p.fetch_status}${p.http_status ? ' ' + p.http_status : ''}]\n${p.text ? p.text : '(no text — not machine-checkable)'}`
    ).join('\n\n');
    return {
      content: [{ type: 'text', text: `Validation assigned:\nOrg: ${result.org?.name}\nRound: ${result.round_id}\nYour validation claim ID (submit against this one): ${result.claim_id}\n\n---\n\n${validateMethodology}\n\n--- SOURCE REPORTS ---\n\n${reports}\n\n--- CACHED PAGE TEXT (use ONLY this; do not fetch) ---\n\n${pages}` }],
    };
  } catch (err) {
    if (err.status === 404 || err.status === 204) {
      return { content: [{ type: 'text', text: 'No validations assigned to you right now.' }] };
    }
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('submit_validation', 'Submit a validation: corrected ("validated") versions of the source reports. You may only SUBTRACT unsupported/fabricated EVIDENCE TABLE rows or CORRECT a quote to match its cited page — never ADD new evidence. Provide full corrected markdown for each report you changed; omit reports you left unchanged.', {
  claim_id: z.string().describe('Your validation claim_id from get_next_validation'),
  validated_reports: z.array(z.object({
    claim_id: z.string().describe('A source report\'s claim_id'),
    report_markdown: z.string().describe('That report\'s full corrected markdown'),
  })).describe('One entry per report you changed. Omit reports you did not change.'),
  validation_notes: z.string().optional().describe('Short summary of what you cut/corrected and why'),
  estimated_tokens: z.number().optional().describe('Honest total token estimate for this validation run'),
}, async ({ claim_id, validated_reports, validation_notes, estimated_tokens }) => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };

  try {
    const result = await client.submitValidation(claim_id, validated_reports, validation_notes, estimated_tokens ?? null);
    markContributed();
    return {
      content: [{ type: 'text', text: `Validation submitted for ${result.org_name}: ${result.reports_validated} report(s) validated. Consolidation will follow.` }],
    };
  } catch (err) {
    // Surface the structured detail the server returns so the agent knows
    // exactly what to fix: which rows' quotes weren't on the page, which URLs
    // were newly introduced, or which structure checks failed.
    const detail = [];
    if (err.data?.validation_errors) detail.push(err.data.validation_errors.join('\n'));
    if (err.data?.fabricated_rows) detail.push(`Rows whose quote is not on the cited page: ${err.data.fabricated_rows.join(', ')}. Copy the quote verbatim from the cached page text, or remove the row.`);
    if (err.data?.new_urls) detail.push(`New URLs not in the original (not allowed): ${err.data.new_urls.join(', ')}`);
    return { content: [{ type: 'text', text: `Validation error: ${err.message}${detail.length ? '\n' + detail.join('\n') : ''}` }] };
  }
});

server.tool('set_role_preference', 'Set whether THIS agent prefers the low-fetch roles (validation & consolidation). Turn it on for a local/cheap model: the agent gets those no-scrape assignments first and waits instead of auto-starting an expensive research run when none is queued.', {
  prefer_low_fetch_roles: z.boolean().describe('true = prefer validation/consolidation (best for local models); false = also do fresh research.'),
}, async ({ prefer_low_fetch_roles }) => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };
  try {
    const result = await client.setRolePreference(prefer_low_fetch_roles);
    return { content: [{ type: 'text', text: `Agent "${result.agent}" now ${result.prefers_low_fetch_roles ? 'PREFERS validation/consolidation (skips auto-research)' : 'does fresh research too'}.` }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('list_agents', 'List your agents (concurrent workers). Each has its own key + role preference; the one you call as is is_current. Also returns your agent_limit.', {}, async () => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };
  try {
    const result = await client.listAgents();
    const lines = (result.agents || []).map((a) =>
      `- [${a.id}] ${a.label}${a.is_current ? ' (this one)' : ''}${a.prefers_low_fetch_roles ? ' · low-fetch' : ''}${a.last_used_at ? ` · last used ${a.last_used_at}` : ''}`
    ).join('\n');
    return { content: [{ type: 'text', text: `Agents (limit ${result.agent_limit}):\n${lines}` }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('create_agent', 'Create a new agent (a separate concurrent worker) and get its API key — so you can run another harness at the same time (e.g. a local Qwen alongside Codex). Returns the key ONCE. Subject to your agent limit (default 2).', {
  label: z.string().describe('A name for the new worker, e.g. "qwen-local".'),
  prefer_low_fetch_roles: z.boolean().optional().describe('true if this agent runs a local/cheap model (prefers validation/consolidation).'),
}, async ({ label, prefer_low_fetch_roles }) => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };
  try {
    const result = await client.createAgent(label, !!prefer_low_fetch_roles);
    return { content: [{ type: 'text', text: `Created agent "${result.agent.label}" (id ${result.agent.id}).\n\nIts API key (shown once — configure the other harness with it):\n${result.api_key}` }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('rotate_agent_key', 'Rotate one of your agents\' API keys (get the id from list_agents). The old key stops working immediately; reconfigure that harness with the new key. Use if a key leaked.', {
  agent_id: z.number().describe('The id of the agent to rotate (from list_agents).'),
}, async ({ agent_id }) => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };
  try {
    const result = await client.rotateAgentKey(agent_id);
    return { content: [{ type: 'text', text: `Rotated key for agent "${result.label}". New key (shown once):\n${result.api_key}` }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

server.tool('revoke_agent', 'Permanently revoke one of your agents (get the id from list_agents). Its key stops working and the slot frees up. You cannot revoke your only agent.', {
  agent_id: z.number().describe('The id of the agent to revoke (from list_agents).'),
}, async ({ agent_id }) => {
  if (!client) return { content: [{ type: 'text', text: 'Error: TFG_API_KEY not set.' }] };
  try {
    await client.revokeAgent(agent_id);
    return { content: [{ type: 'text', text: `Revoked agent ${agent_id}.` }] };
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

  // If the user just wired up a recurring schedule, tell the server too. This
  // is what flips `has_schedule`, which lights the "Auto-contributing" badge on
  // their dashboard — the only product-side confirmation that scheduling worked.
  // Best-effort: the badge is non-critical, so a failure here never blocks setup.
  const state = loadState();
  if (client && (state.intended_flow === 'scheduled' || state.auto_schedule)) {
    try {
      await client.enableSchedule();
    } catch {
      // Dashboard badge is cosmetic; /schedule in Claude Code is the source of truth.
    }
  }

  return { content: [{ type: 'text', text: 'Marked setup complete. The SessionStart hook will go silent from the next session.' }] };
});

server.tool('snooze', 'Snooze Tokens for Good reminders. Call this when the user says to remind them tomorrow, next week, or in N days.', {
  days: z.number().int().min(1).max(365).describe('Days to snooze (1 = tomorrow, 7 = next week)'),
}, async ({ days }) => {
  snoozeDays(days);
  return { content: [{ type: 'text', text: `Got it — Tokens for Good will stay quiet for ${days} day${days === 1 ? '' : 's'}.` }] };
});

// --- Prompts (session start) ---

server.prompt('session_start', 'Check if you should research an org', {}, async () => {
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
