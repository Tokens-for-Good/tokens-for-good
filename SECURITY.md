# Security

Tokens for Good asks you to point an AI agent, running on your subscription, at a queue of nonprofits. That only works if you can see what the agent is allowed to do. This is the short version. The longer write-up is at [tokensforgood.ai/security](https://tokensforgood.ai/security).

## Reporting a vulnerability

Please do not open a public GitHub issue for a vulnerability.

1. **Preferred:** open a private ticket from [Help & support](https://tokensforgood.ai/support) on your dashboard (sign in with GitHub first, it's free).
2. **No account, or the site is the problem:** email **hank@tokensforgood.ai**. It's a real, monitored two-way address.

Tell us what you found, how to reproduce it, and what an attacker gets out of it. We read these quickly and will keep you updated until it is fixed. There is no bug bounty; we will credit you in the fix commit if you want the credit.

Public GitHub issues are the right place for *design* ideas and hardening suggestions that don't expose anyone: [open one here](https://github.com/Tokens-for-Good/tokens-for-good/issues/new/choose).

## Supported versions

Fixes ship on the latest published version of the `tokens-for-good` npm package. Older versions are not patched. If you run a scheduled routine, run `/tfg-schedule` once to reinstall it on the current format.

## What a research run does

Every run reads public pages and sends back one report:

- **Reads:** the claimed organization's public website and public sources about it (search results, annual reports, ProPublica 990 filings, independent evaluations, charity raters).
- **Sends:** one research report and an honest token estimate, to the Tokens for Good API over HTTPS. Requests also carry the package version, platform name, and a random per-install id (so we can spot a broken routine); the server logs those with a hashed IP.
- **Never touches:** your files, your repos, your other MCP servers or connected accounts, your browser session, your credentials, or anything that spends money.
- **Tools it needs:** web search, web fetch, and (for scheduled routines) `curl` to our API. Nothing else. If you want extra isolation, run it in a context with no other sensitive accounts connected.

The agent prints that plan before it starts researching, so you can see it in the transcript rather than taking our word for it.

## Client-side model

- **Scheduled routines are self-contained.** The full research methodology is embedded in the routine prompt when you install it, so its instructions are frozen at install time and nothing remote can change what your standing agent does. At runtime the routine only exchanges JSON data with the API: an org to research, a submission receipt, and a version handshake at `/api/research/parameters` (numbers and row keys, no prose).
- **Routines created before July 2026 fetched instructions at runtime**, which is exactly the pattern prompt-injection warnings exist to catch. That design is retired. Run `/tfg-schedule` once to upgrade in place, keeping your cadence and current key.
- **Your API key** lives in your MCP config. It is sent only as the `X-TFG-Api-Key` header, never in a URL, and only to `https://tokensforgood.ai` (the client refuses any other scheme or host, and never follows a redirect with the key attached). Rotate or revoke it any time from your dashboard; rotation invalidates the old key immediately.
- **A scheduled routine gets its own key.** The routine runs on Anthropic's cloud without this package, so its prompt has to carry a key. `setup_automation` mints a separate agent on your account (label `routine`) and embeds that agent's key, never the one your interactive session uses; re-running it rotates the routine key. Revoke or rotate the `routine` agent from `list_agents` to stop the routine without touching anything else.
- **Tool results persist in transcripts.** Claude Code writes every MCP tool result to `~/.claude/projects/<project>/<session>.jsonl` and keeps it for 30 days by default (`cleanupPeriodDays`); other harnesses keep their own logs. That is why `create_agent` and `rotate_agent_key` print a masked key (`tfg_live_ab…cd`) unless you pass `reveal: true`, and why the routine key is a separate one. Treat any key you reveal in a session as present in that session's transcript, and rotate it if the transcript is ever shared.
- **Local state** (`~/.tokens-for-good/state.json`) holds a cadence preference, timestamps, and a random per-machine install id. The directory is created `0700` and the file `0600`. No report content and no credentials beyond your key's own config live there.
- **The package runs from a fixed location.** init writes harness entries that run `node <absolute path>/src/cli.js`, never `npx tokens-for-good`: npm resolves a bare package name from the current project's `node_modules` first, so a repository carrying its own `tokens-for-good` could have run as your MCP server (with your key in its environment) and as your session-start hook. When init itself was run through `npx`, it first installs the exact version it is running, with `--ignore-scripts`, under `~/.tokens-for-good/pkg` and points the entries there; a checkout or global install is used in place. Re-run init after upgrading the package to move the entries to the new version.
- **Report bodies never go through a shell.** The routine writes the JSON body to a file and posts it with `curl -d @file`, so report text with quotes or shell metacharacters cannot break out of a command on an unattended run.

## Server-side model

- Every report passes deterministic citation verification: each EVIDENCE TABLE quote must actually appear on the page it cites.
- Every org is researched twice independently, an independent validator prunes unsupported rows against cached page text, and a consolidator merges the two. The final score is computed by code, never by the model that wrote the report.
- API keys are SHA-256 hashed at rest and compared with `hash_equals`. The authenticated API is rate limited per key.
- Server-side fetches of contributor-supplied URLs go through one hardened fetcher: http(s) only, private, reserved, loopback, and link-local targets blocked, DNS pinned per connection, and each redirect hop revalidated.

## Scope

In scope: the `tokens-for-good` npm package and CLI, the MCP server (`src/mcp-server.js`), the remote MCP endpoint at `https://tokensforgood.ai/mcp`, and the research API at `https://tokensforgood.ai/api/*`.

Out of scope: findings that require a compromised machine or a stolen API key you control, missing security headers with no demonstrated impact, volumetric denial of service, and automated scanner output with no working proof of concept.
