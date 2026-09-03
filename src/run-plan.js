// The run-plan preview: the short "here is exactly what I am about to do"
// block an agent shows the user before it starts researching an org.
//
// This file is the SINGLE SOURCE for that copy. Everything that needs it
// imports from here: the `claim_org` MCP tool result, the `setup_guide` /
// no-key onboarding message, and the embedded scheduled-routine prompt in
// platform.js. The skill files deliberately do NOT restate it; they just tell
// the agent to print the block the tool handed back, so there is one place to
// edit the wording.
//
// Why show-and-proceed rather than pause-and-confirm: the point is to bring
// the user along on a first run, not to add an approval gate to a task they
// already asked for. A pause also breaks unattended scheduled runs, where
// nobody is there to answer.
import { cleanText } from './untrusted.js';

// Tool results carry the org name and url on their single untrusted data
// line; the plan refers to that line rather than repeating the text, so
// server-relayed free text appears exactly once, labelled.
export const CLAIMED_ORG_REF = 'the organization on the data line above (its name and url are shown there)';

/**
 * The plan itself, as markdown the agent prints verbatim.
 *
 * @param {{orgName?: string|null, orgUrl?: string|null, orgRef?: string|null}} [org]
 *   orgRef is a fixed phrase pointing at the org (see CLAIMED_ORG_REF);
 *   orgName/orgUrl are used in the scheduled prompt's placeholder form.
 */
export function runPlan({ orgName = null, orgUrl = null, orgRef = null } = {}) {
  const target = orgRef
    ? orgRef
    : orgName
      ? `${cleanText(orgName, 120)}${orgUrl ? ` (${cleanText(orgUrl, 200)})` : ''}`
      : 'the next organization in the Tokens for Good queue';

  return `**Run plan**
- **Researching:** ${target}
- **Reads:** that organization's public website plus public sources about it (web search results, annual reports, ProPublica 990 filings, independent evaluations, charity raters). Public pages only.
- **Sends back:** one research report and an honest token estimate, to the Tokens for Good API. Requests also carry the package version, platform name, and a random install id so we can spot a broken routine. Nothing goes anywhere else.
- **Never touches:** your files, your repos, your other MCP servers or connected accounts, your browser session, your credentials, or anything that spends money.
- **Takes:** about 5 minutes.`;
}

/**
 * The plan plus the instructions the agent needs to act on it. This is what
 * tool results embed.
 *
 * @param {{orgName?: string|null, orgUrl?: string|null, orgRef?: string|null}} [org]
 */
export function runPlanForAgent(org = {}) {
  return `${runPlan(org)}

Print the run plan above to the user verbatim before your first research step, then keep going. Do not wait for a confirmation; it is a heads up, not an approval gate.
${TOOL_STEERING}`;
}

/**
 * Tool steering that keeps the run inside the plan. Delba's first run startled
 * her by reaching for a browser-automation tool to "read this page"; fetch and
 * search are the only tools this work needs.
 */
export const TOOL_STEERING = `Read every page with your web search and web fetch tools. Do not open or drive a browser (no browser automation, no Chrome extension, no Playwright), do not sign in to anything, and do not read or write local files beyond what your harness needs to submit the report.`;

/**
 * The pre-install version for onboarding copy, where no org is claimed yet.
 */
export function runPlanPreviewForSetup() {
  return `**What the first run will do**

${runPlan()}

It shows the user this plan and then proceeds; there is no approval gate.`;
}
