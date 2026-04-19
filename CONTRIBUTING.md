# Contributing to Tokens for Good

Thanks for looking. TFG is a small npm package (MCP server + CLI + a couple of Claude Code skills) that turns spare AI subscription tokens into nonprofit research for Fierce Philanthropy. The current 0.4.x line was built and tested on **Claude Code only**. Making it genuinely pleasant on other harnesses — OpenCode, Cursor, Windsurf, Devin, and anything else with MCP support — is the single biggest way external contributors can help.

This doc covers how the package fits together, what a harness port actually touches, the testing pattern, and how to ship a change. If you're adding a new harness, skim [Project Structure](#project-structure) and [Touch Points When Porting](#touch-points-when-porting-to-a-new-harness) first.

## Getting set up

```bash
git clone https://github.com/Tokens-for-Good/tokens-for-good
cd tokens-for-good
npm install
```

You'll need Node 18+ and an npm account to publish (maintainers only).

To exercise a change locally without publishing:

```bash
# Run the MCP server directly (stdio)
node src/mcp-server.js

# Run the init CLI
node src/cli.js init

# Run the SessionStart hook
node src/cli.js session-start-hook
```

To test in Claude Code against your local checkout instead of the published package, point `~/.mcp.json` at the absolute path:

```json
{
  "mcpServers": {
    "tokens-for-good": {
      "command": "node",
      "args": ["/absolute/path/to/tokens-for-good/src/mcp-server.js"],
      "env": { "TFG_API_KEY": "tfg_live_..." }
    }
  }
}
```

Restart Claude Code fully after editing `.mcp.json`.

## Project structure

```
tokens-for-good/
├── src/
│   ├── cli.js                  Entry point for `npx tokens-for-good <subcommand>`
│   ├── mcp-server.js           MCP server — tools, prompts, resources
│   ├── init.js                 Interactive setup (asks cadence, writes configs)
│   ├── session-start-hook.js   Hook body that Claude Code invokes on every session
│   ├── platform.js             Harness detection + automation instructions
│   ├── api-client.js           Thin wrapper around the Fierce Philanthropy HTTP API
│   └── state.js                Local state file at ~/.tokens-for-good/state.json
├── skills/
│   ├── tfg.md                  /tfg skill body (Claude Code)
│   └── tfg-schedule.md         /tfg-schedule skill body (Claude Code)
├── pipeline/                   Research methodology prompts served by the API
├── README.md
└── CONTRIBUTING.md             (you are here)
```

## How the pieces talk to each other

The mental model most contributors need:

1. **User runs `npx tokens-for-good init`** in a terminal. init asks for an API key + cadence (daily / weekly / hourly / one-off), then writes up to five things in one shot:
   - MCP config in the harness-appropriate location
   - A SessionStart hook entry (Claude Code only for now)
   - The `/tfg` and `/tfg-schedule` skill files (Claude Code only for now)
   - `~/.tokens-for-good/state.json` with the chosen flow
2. **The user opens the harness.** A SessionStart-style hook (or whatever the harness provides) runs `npx tokens-for-good session-start-hook`, which reads state.json and, on the first session after init, emits a JSON payload telling the AI to invoke `/tfg-schedule` or `/tfg`.
3. **The AI invokes the skill.** Skills are Markdown instruction files the AI reads and follows. `/tfg-schedule` tells it to call the TFG MCP's `setup_automation` tool, extract the scheduled-research prompt, and invoke the harness's scheduling mechanism (Claude Code's `/schedule`, OpenCode's cron, Devin's recurring sessions, etc.).
4. **Scheduled runs call the API directly**, not the MCP. The research agent uses `WebFetch` against the TFG HTTP endpoints so it can run on cloud infrastructure that has no local MCP access.

The MCP server itself is platform-neutral — it's standard MCP. The harness-specific plumbing lives in `init.js`, `platform.js`, `session-start-hook.js`, and the Markdown skill files.

## Touch points when porting to a new harness

This is where most external contributions will land. A port doesn't have to hit every touch point — it's fine to ship partial fidelity and iterate.

### 1. `src/platform.js`

Add detection and automation instructions:

```js
// detectPlatform() — add an env-var check for your harness
if (process.env.MY_HARNESS) return 'my-harness';

// isSchedulable() — does your harness have any form of recurring task?
export function isSchedulable(platform) {
  return ['claude-code', 'opencode', 'devin', 'my-harness'].includes(platform);
}

// getAutomationInstructions() — return the human-readable setup steps
case 'my-harness':
  return `Set up automated contributions with <whatever your harness offers>...`;
```

If you're not sure what env var your harness sets, grep your harness's source or docs. Don't guess — if detection is flaky, the wrong branch runs and the UX gets worse.

### 2. `src/init.js`

init writes files in platform-appropriate locations. The existing code handles Claude Code, OpenCode, Cursor, Windsurf, and Devin at varying levels of completeness. For a new harness:

- **`absoluteMcpPath(platform)`** — where does your harness read its MCP config? (`~/.config/<harness>/...`, `<project>/.<harness>/mcp.json`, etc.)
- **`writeMcpConfig(platform, apiKey)`** — what's the JSON shape? Some harnesses use `mcpServers`, some use `mcp`, some use something else entirely.
- **`planWrites(platform)`** — update the preview so the confirm prompt shows an accurate list.
- **`printClosingGuidance(platform, flow, freq)`** — tell the user what happens next on their harness.

For Claude Code specifically, init also writes a SessionStart hook and skill files. If your harness has an equivalent (most do — some call them rules, commands, prompts, agents), add a writer function that follows the same pattern: check if already registered, append, preserve existing entries.

### 3. `src/session-start-hook.js`

The current hook is Claude Code-specific in its output format — it emits:

```json
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
```

If your harness has a session-start hook but expects a different output schema, add a branch that emits the right shape. Detect the harness via env var (the same one `platform.js` uses) and pick the right emitter.

If your harness has no session-start hook, skip it. The `/tfg` skill will still work; users just won't get the automatic handoff on first session.

### 4. Skills

`skills/tfg.md` and `skills/tfg-schedule.md` are Claude Code's SKILL.md format. If your harness has:

- **Slash commands / prompts** (OpenCode, Cursor, Windsurf): create an equivalent file in that harness's format and have `init.js` write it.
- **Rules / system prompts** (Cursor `.cursorrules`, Windsurf `.windsurfrules`): similar — translate the instructions into the target format.
- **Nothing of the sort** (Devin, for example): skip. The AI can still do the work, you just can't invoke it with a one-word command.

### 5. Scheduling

`/tfg-schedule` hands off to Claude Code's `/schedule`, which lives on Anthropic's cloud. Other harnesses have very different models:

- **OpenCode**: no built-in scheduler. Falls back to `cron` on the user's machine. init already prints the correct cron line for this.
- **Cursor / Windsurf**: no scheduler at all currently. Scheduled flow probably isn't feasible — fall back to one-off with a reminder nudge.
- **Devin**: native recurring sessions. Configure via their UI or API.

When porting, be honest in `getAutomationInstructions()` about what's possible on your harness. "Scheduled" should mean "runs without the user being present" — if that's not really true, call the flow something else or disable it.

## Testing

The repo has no formal test framework yet — tests are run as inline scripts against scratch `HOME` directories so local state isn't touched. An example pattern (this is how 0.4.x was verified):

```js
import { spawnSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const SCRATCH = join(tmpdir(), 'tfg-test-' + Date.now());
mkdirSync(SCRATCH, { recursive: true });
mkdirSync(join(SCRATCH, '.tokens-for-good'), { recursive: true });
writeFileSync(
  join(SCRATCH, '.tokens-for-good', 'state.json'),
  JSON.stringify({ intended_flow: 'scheduled', intended_frequency: 'daily' })
);

const r = spawnSync(
  process.execPath,
  ['src/cli.js', 'session-start-hook'],
  { env: { ...process.env, USERPROFILE: SCRATCH, HOME: SCRATCH }, encoding: 'utf-8' }
);
console.log(r.stdout);  // should be the first-session JSON
rmSync(SCRATCH, { recursive: true, force: true });
```

For init, use `prompts.inject([...])` to script answers. The relevant import is `node_modules/prompts/index.js`.

A proper `vitest` setup would be welcome — that's a great first PR.

## Coding conventions

- **ES modules only** (the package is `"type": "module"`).
- **Node's standard library is preferred** over deps. `prompts` is the only runtime dep we added in 0.4.x — keep that bar high.
- **Cross-platform paths**: always `path.join()` and `os.homedir()`, never hard-coded `~` or forward/back slashes.
- **Sync I/O is fine** for one-shot CLI flows (init, hooks). Don't reach for async complexity unless it buys something real.
- **Comments explain *why* only.** What the code does should be self-evident from names. Long docstrings are discouraged.
- **No `any` types.** The package is plain JS today, but when/if we adopt TypeScript, that's a hard rule.

## Shipping a change

Maintainers only, but useful to know the flow:

1. Bump version in `package.json` (semver — 0.4.x patches for fixes, 0.5.0 for features, etc.).
2. Run `npm install` to regenerate `package-lock.json`.
3. Commit (include a short "why" in the message, not just "what").
4. `git push origin master`.
5. `npm publish`.

The `files` field in `package.json` controls what ships. Keep it tight — node_modules, tests, docs, and `.git*` are excluded by default.

## Filing issues

- **Bugs**: [GitHub issues](https://github.com/Tokens-for-Good/tokens-for-good/issues) with a repro. "It didn't nudge me" → include your OS, harness, harness version, and the output of `npx tokens-for-good session-start-hook` run manually.
- **Harness ports**: file an issue first so we can sanity-check the plan before you invest a day on code. Happy to talk through the touch points.
- **Feature ideas**: same — issue first.

## A note on scope

TFG's MCP tools are deliberately small and stable. The interesting work is almost always in `init.js`, `platform.js`, skills/, and the hook — i.e. the harness adapter layer. If you're thinking about adding a new MCP tool, run it by an issue first. Most new ideas are better served by an existing tool + a skill that chains them.

Thanks for reading. The project is small on purpose — it should be legible in an afternoon.
