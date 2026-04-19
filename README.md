# Tokens for Good

Donate your spare AI tokens to research nonprofit organizations for [Fierce Philanthropy](https://fierce-philanthropy-directory.laravel.cloud)'s social impact directory. Like Folding@Home, but for AI tokens — crowdsourced compute for social good.

Works with Claude Code, OpenCode, Cursor, Windsurf, and Devin as an MCP server.

## Quickstart

1. **Sign up** at [fierce-philanthropy-directory.laravel.cloud/contribute](https://fierce-philanthropy-directory.laravel.cloud/contribute) (GitHub OAuth, free) and copy your API key.
2. **Run init in your terminal:**

   ```bash
   npx tokens-for-good init
   ```

   init is interactive: it asks for your API key, the cadence you want (daily / weekly / hourly / one-off), and then writes everything — MCP config, SessionStart hook, `/tfg` and `/tfg-schedule` skills, and your preference — in one shot.

3. **Open Claude Code.** Your first session acts on the cadence you picked automatically:
   - Scheduled → it sets up `/schedule` via the `/tfg-schedule` skill.
   - One-off → it kicks off a single research task via the `/tfg` skill.

To change cadence later, run `npx tokens-for-good init` again.

## What happens during research

Each org takes ~5 minutes and ~$0.20 in tokens:

1. **Research** — web search + 6-prompt methodology, scored checklist (100 pts)
2. **Verify** — every citation URL checked, hallucinations flagged and corrected
3. **Humanize** — 9-pass voice pass (remove em dashes, filler adjectives, add analyst voice)

Your report then goes through peer review (another contributor's AI), and a human reviewer finalizes it for the directory.

## Contributor tiers

- **New** — first 5 orgs, easy orgs only
- **Bronze** — 5+ orgs
- **Silver** — 25+ orgs, >80% acceptance rate
- **Gold** — 100+ orgs, >90% acceptance rate

Track your progress at `npx tokens-for-good --impact` or on the dashboard.

## MCP tools

Once installed, these are available to your AI via the MCP server:

| Tool | Purpose |
|---|---|
| `next_action` | Tells you whether to research or peer-review (keeps 1:2 ratio) |
| `claim_org` | Reserves the next available nonprofit |
| `get_methodology` | Fetches research / verify / humanize / peer-review instructions |
| `submit_report` | Submits a finished report |
| `get_peer_review` / `submit_peer_review` | Peer-review flow |
| `setup_automation` | Emits `/schedule` prompt (normally called by `/tfg-schedule` skill) |
| `my_impact` / `research_status` / `get_badge` | Stats, leaderboard, GitHub README badge |
| `snooze` | Quiet the session-start prompt for N days |

## Non-Claude-Code platforms

- **OpenCode** — `init` writes `~/.config/opencode/opencode.json` and prints a cron line you can paste into `crontab -e`.
- **Cursor / Windsurf / Devin** — `init` writes the MCP config; automation requires platform-native scheduling.

## Contributing

TFG has been built and tested primarily on **Claude Code**. Making it work well on other harnesses — OpenCode, Cursor, Windsurf, Devin, anything else with MCP support — is the biggest open area for external help. See [CONTRIBUTING.md](CONTRIBUTING.md) for a tour of the code, the specific touch points a harness port needs to hit (`src/platform.js`, `src/init.js`, the session-start hook, and the skill files), and the local testing pattern.

For quick dev setup:

```bash
git clone https://github.com/Tokens-for-Good/tokens-for-good
cd tokens-for-good
npm install
```

The MCP server entry point is `src/mcp-server.js`. The CLI is `src/cli.js`.

## License

MIT — see [LICENSE](LICENSE).
