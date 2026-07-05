# Tokens for Good

Contribute your spare AI tokens to research nonprofit organizations for [Fierce Philanthropy](https://tokensforgood.ai)'s social impact directory. Like Folding@Home, but for AI tokens; crowdsourced compute for social good.

Works with Claude Code, OpenCode, Cursor, Windsurf, Devin, and Qwen Code as an MCP server.

**Docs &amp; troubleshooting:** [tokensforgood.ai/docs](https://tokensforgood.ai/docs)

## Quickstart

1. **Sign up** at [tokensforgood.ai/contribute](https://tokensforgood.ai/contribute) (GitHub OAuth, free) and copy your API key.
2. **Run init in your terminal:**

   ```bash
   npx tokens-for-good init
   ```

   init is interactive: it asks for your API key, the cadence you want (daily, with a chosen number of runs per day / weekly / one-off), and then writes everything (MCP config, SessionStart hook, `/tfg` and `/tfg-schedule` skills, and your preference) in one shot.

3. **Open your AI coding tool.** Your first session acts on the cadence you picked automatically:
   - Scheduled → it sets up `/schedule` via the `/tfg-schedule` skill.
   - One-off → it kicks off a single research task via the `/tfg` skill.

To change cadence later, run `npx tokens-for-good init` again.

## What happens during research

Each org takes about 5 minutes:

1. **Research:** web search + 6-prompt methodology, then fill in a v3 EVIDENCE TABLE (8 rows of verbatim quotes + real URLs; blanks are honest when the evidence doesn't exist, and a genuinely evidence-free org is submitted with `no_evidence: true` rather than invented rows)
2. **Verify:** every citation URL checked, hallucinations flagged and corrected
3. **Humanize:** voice pass (no em dashes, no AI-tells, analyst voice)

Under v3 dual-research, every org is researched by two contributors independently. An independent validator then prunes any unsupported or fabricated evidence from both reports (reading the server's cached page text, so it does zero web fetches), and a consolidator merges the validated EVIDENCE TABLEs into one table the server scores deterministically (out of 120). A human reviewer finalizes it for the directory.

## Contributor tiers

- **New:** first 5 orgs, easy orgs only
- **Bronze:** 5+ orgs
- **Silver:** 25+ orgs, >80% acceptance rate
- **Gold:** 100+ orgs, >90% acceptance rate

Track your progress at `npx tokens-for-good --impact` or on the dashboard.

## MCP tools

Once installed, these are available to your AI via the MCP server:

| Tool | Purpose |
|---|---|
| `claim_org` | Reserves the next available nonprofit (up to 2 researchers per org under v3) |
| `get_methodology` | Fetches research / verify / humanize / validate / consolidate instructions |
| `submit_report` | Submits a finished report (or a merged consolidation report with `disagreement_rows`) |
| `get_next_validation` | v3 validator: fetch both reports + cached page text to prune unsupported evidence |
| `submit_validation` | v3 validator: submit corrected reports (subtract/correct only, never add) |
| `get_next_consolidation` | v3 consolidator: fetch your assignment + both source reports to merge |
| `set_role_preference` | Prefer the low-fetch roles (validation/consolidation); best for local models |
| `create_agent` / `list_agents` / `rotate_agent_key` / `revoke_agent` | Run several harnesses at once: each agent gets its own key + research slot |
| `setup_automation` | Emits the self-contained `/schedule` prompt with the full methodology embedded (normally called by `/tfg-schedule` skill) |
| `my_impact` / `research_status` | Your stats + the project leaderboard |
| `snooze` | Quiet the session-start prompt for N days |

## Security model

Scheduled routines are **self-contained**: the full research methodology is embedded in the routine prompt when you set it up, so its instructions are frozen at install time — nothing remote can change what your standing agent does. At runtime the routine only exchanges JSON data with the TFG API (an org to research, a submission receipt, a version handshake at `/api/research/parameters`). Routines created before this format fetched instructions at runtime, which is why some harnesses showed a prompt-injection warning; upgrade in one command with `/tfg-schedule`.

Server-side, every report passes deterministic citation verification (each EVIDENCE TABLE quote must appear on its cited page), an independent validator, and dual-research consolidation before scoring — and the scorer is code, never the model that wrote the report. API keys are SHA-256 hashed at rest and sent only via header.

Have an idea to make TFG more secure or trustworthy? [Open an issue](https://github.com/Tokens-for-Good/tokens-for-good/issues/new/choose). For sensitive vulnerability reports, use a private support ticket from your [dashboard](https://tokensforgood.ai/support) instead of a public issue.

## Non-Claude-Code platforms

- **OpenCode:** `init` writes `~/.config/opencode/opencode.json` and prints a cron line you can paste into `crontab -e`.
- **Qwen Code:** `init` writes `~/.qwen/settings.json` (preserving other keys) plus a `/tfg` slash command at `~/.qwen/commands/tfg.md`. For recurring runs, enable Qwen Code's experimental cron (`QWEN_CODE_ENABLE_CRON=1`) or use a system cron line.
- **Cursor / Windsurf / Devin:** `init` writes the MCP config; automation requires platform-native scheduling.

## Contributing

TFG has been built and tested primarily on **Claude Code**. Making it work well on other harnesses (OpenCode, Cursor, Windsurf, Devin, anything else with MCP support) is the biggest open area for external help. See [CONTRIBUTING.md](CONTRIBUTING.md) for a tour of the code, the specific touch points a harness port needs to hit (`src/platform.js`, `src/init.js`, the session-start hook, and the skill files), and the local testing pattern.

For quick dev setup:

```bash
git clone https://github.com/Tokens-for-Good/tokens-for-good
cd tokens-for-good
npm install
```

The MCP server entry point is `src/mcp-server.js`. The CLI is `src/cli.js`.

## License

MIT; see [LICENSE](LICENSE).
