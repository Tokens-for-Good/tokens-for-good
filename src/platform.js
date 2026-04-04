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
  return `You are a research agent for Fierce Philanthropy's Tokens for Good program. Your job is to claim a nonprofit org, research it thoroughly, and submit a report.

## API Access

Base URL: https://fierce-philanthropy-directory.laravel.cloud/api
Auth header: X-TFG-Api-Key: ${apiKey}

## Steps

### 1. Claim an org
Use WebFetch to POST to /api/research/claim:

WebFetch URL: https://fierce-philanthropy-directory.laravel.cloud/api/research/claim
Method: POST
Headers: X-TFG-Api-Key: ${apiKey}, Content-Type: application/json
Body: {"platform": "claude-code-scheduled"}

This returns the org name, URL, description, and a claim_id. You have 30 minutes.

### 2. Research the org
Use WebSearch and WebFetch to thoroughly research the organization:
- The org's website, impact pages, annual reports
- Independent evaluations (RCTs, J-PAL, 3ie)
- Third-party reviews (GiveWell, Charity Navigator)
- Financial data (ProPublica Nonprofit Explorer)

### 3. Write the report
Follow the Fierce Philanthropy research methodology:

**PROMPT 1** - Org and Social Problem Summary (problem, population, location)
**PROMPT 2** - Top 20 Negative Consequences table
**PROMPT 3** - Classify each as Intermediary or Ultimate Outcome
**PROMPT 4** - Positive Results shared by the org (with citations)
**PROMPT 5** - Counterfactual Results (with citations)

**SUMMARY REPORT** with 7 sections:
1. Our Recommendation (with scored checklist)
2. The Social Problem
3. The Solution
4. Key Outputs
5. Key Intermediate Outcomes
6. Key Ultimate Outcomes
7. Continual Learning & Adaptation

**SOURCES** - All cited sources with full URLs

#### Scoring Checklist (use EXACTLY these criteria):

Base score (out of 100):
- [x] or [ ] a. Has Ultimate Outcome Goals (50 pts)
- [x] or [ ] b. Measures Intermediate Outcomes (10 pts)
- [x] or [ ] c. Measures Ultimate Outcomes (15 pts)
- [x] or [ ] d. Shows Continual Learning & Adaptation (25 pts)

Extra credit:
- [x] or [ ] e. Measures Intermediate Counterfactual (10 pts)
- [x] or [ ] f. Measures Ultimate Counterfactual (10 pts)

**Score: [X]/100** (can exceed 100 with extra credit, max 120)

### 4. Submit the report
Use WebFetch to POST to /api/research/submit:

WebFetch URL: https://fierce-philanthropy-directory.laravel.cloud/api/research/submit
Method: POST
Headers: X-TFG-Api-Key: ${apiKey}, Content-Type: application/json
Body: {"claim_id": <claim_id from step 1>, "report_markdown": "<full report>", "model_used": "claude-code-scheduled"}

### Rules
- Every factual claim needs an inline citation [Source Name](URL)
- Only use direct results from the org, not from similar orgs
- No anecdotes, only measured results
- Paragraphs under 4 sentences
- No em dashes, no filler adjectives, no AI tells`;
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
