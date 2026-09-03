// Interactive first-time setup CLI for Tokens for Good.
// Invoked as `npx tokens-for-good init`. Blocks on a mandatory frequency
// choice and writes MCP config, SessionStart hook, skills, and state.json
// so the user's next Claude Code session acts on their choice immediately.
import prompts from 'prompts';
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, unlinkSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { detectPlatform, cronForSchedule, MAX_RUNS_PER_DAY } from './platform.js';
import { loadState, saveState, getOrCreateInstallId } from './state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const PKG_VERSION = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8')).version;

const FREQUENCY_CHOICES = [
  { title: 'Daily (recommended); pick how many runs per day next',        value: 'daily'   },
  { title: 'Weekly; light touch',                                         value: 'weekly'  },
  { title: "One-off; I'll run research manually when I feel like it",     value: 'one_off' },
];

const PLATFORM_CHOICES = [
  { title: 'Claude Code',  value: 'claude-code' },
  { title: 'OpenCode',     value: 'opencode' },
  { title: 'Cursor',       value: 'cursor' },
  { title: 'Windsurf',     value: 'windsurf' },
  { title: 'Devin',        value: 'devin' },
  { title: 'Qwen Code',    value: 'qwen-code' },
];

const onCancel = () => {
  console.log('\nCancelled. Nothing was written.\n');
  process.exit(1);
};

export async function runInit() {
  console.log('\n✨ Tokens for Good; one-time setup\n');

  // Idempotency: offer to reconfigure if already set up
  const existing = loadState();
  if (existing.intended_flow) {
    const { redo } = await prompts({
      type: 'confirm',
      name: 'redo',
      message: `Already set up (${existing.intended_flow}${existing.intended_frequency ? `, ${existing.intended_frequency}${existing.intended_frequency === 'daily' && existing.runs_per_day > 1 ? ` ${existing.runs_per_day}×/day` : ''}` : ''}). Reconfigure?`,
      initial: false,
    }, { onCancel });
    if (!redo) {
      console.log('\nNo changes. Run `npx tokens-for-good init` again anytime to reconfigure.\n');
      return;
    }
  }

  // Step 1: API key
  const { apiKey } = await prompts({
    type: 'password',
    name: 'apiKey',
    message: 'Paste your TFG API key (get one at https://tokensforgood.ai/contribute):',
    validate: v => /^tfg_(live|test)_/.test((v || '').trim()) || 'Key should start with tfg_live_ or tfg_test_',
  }, { onCancel });

  // Step 2: Platform
  const detected = detectPlatform();
  const detectedIdx = Math.max(0, PLATFORM_CHOICES.findIndex(c => c.value === detected));
  const { platform } = await prompts({
    type: 'select',
    name: 'platform',
    message: 'Which AI coding tool will you use TFG from?',
    choices: PLATFORM_CHOICES,
    initial: detectedIdx,
  }, { onCancel });

  // Step 3: Frequency (mandatory choice; this is the whole point of init)
  const { choice } = await prompts({
    type: 'select',
    name: 'choice',
    message: 'How often should Tokens for Good research run?',
    choices: FREQUENCY_CHOICES,
    initial: 0,
  }, { onCancel });

  // Step 3b: Daily cadence; how many runs per day. Claude Code caps the
  // number of scheduled runs per day, so we ask for a count (1-15).
  let runs_per_day = null;
  if (choice === 'daily') {
    const { count } = await prompts({
      type: 'number',
      name: 'count',
      message: `How many times per day? (1-${MAX_RUNS_PER_DAY})`,
      initial: 1,
      min: 1,
      max: MAX_RUNS_PER_DAY,
    }, { onCancel });
    runs_per_day = count || 1;
  }

  const intended_flow = choice === 'one_off' ? 'one_off' : 'scheduled';
  const intended_frequency = choice === 'one_off' ? null : choice;

  // Step 3c: standing permission for the two web tools. Only Claude Code reads
  // ~/.claude/settings.json; other harnesses manage permissions their own way.
  // Asked as its own question rather than folded into the write confirmation,
  // because it widens what the agent may do outside Tokens for Good.
  let allowWebTools = false;
  if (platform === 'claude-code') {
    console.log('\nResearch means reading nonprofit websites and searching the web. Without');
    console.log('standing permission your agent stops to ask on every fetch and every search,');
    console.log('which stalls an unattended run.');
    console.log('');
    console.log('Adding WebFetch and WebSearch to permissions.allow in ~/.claude/settings.json');
    console.log('lets your agent fetch ANY url and run any web search without asking you first,');
    console.log('in every project, not only Tokens for Good. Our server-side SSRF hardening');
    console.log('covers what our servers fetch, not what your agent fetches, so it does not');
    console.log('protect you here. You can undo this anytime with /permissions in Claude Code.');
    console.log('');
    const { allow } = await prompts({
      type: 'confirm',
      name: 'allow',
      message: 'Add WebFetch and WebSearch to your Claude Code allowlist?',
      initial: true,
    }, { onCancel });
    allowWebTools = allow;
  }

  // Step 4: Preview + confirm
  console.log('\nAbout to write:');
  const plans = planWrites(platform, allowWebTools);
  for (const p of plans) console.log(`  • ${p.label}`);
  console.log('');

  const { go } = await prompts({
    type: 'confirm',
    name: 'go',
    message: 'Write these files?',
    initial: true,
  }, { onCancel });
  if (!go) onCancel();

  // Execute. The harness entries run `node <absolute cli.js>`, so first make
  // sure that file lives somewhere stable (see ensureStableRuntime).
  const cliPath = ensureStableRuntime();
  if (isEphemeralInstall()) console.log(`✓ ${plans[0].label}`);
  const written = plans.filter(p => !p.runtime);

  const apiKeyTrimmed = apiKey.trim();
  const { migratedLegacyEntry } = writeMcpConfig(platform, apiKeyTrimmed, cliPath);
  console.log(`✓ ${written[0].label}`);
  if (migratedLegacyEntry) {
    console.log(`    moved the tokens-for-good entry out of ${homeRelative(legacyMcpJsonPath())}: Claude Code read that file as a`);
    console.log(`    per-project .mcp.json (approval prompt in every project under your home folder, no server elsewhere).`);
  }

  if (platform === 'claude-code') {
    writeSessionStartHook(cliPath);
    if (allowWebTools) {
      const { added, skipped } = writePermissionsAllowlist();
      console.log(`✓ ${written[1].label}`);
      if (added.length) console.log(`    added to permissions.allow: ${added.join(', ')}`);
      for (const s of skipped) console.log(`    left as you had it: ${s.tool} (${s.reason})`);
    } else {
      console.log(`✓ ${written[1].label}`);
    }
    writeSkillFile('tfg-schedule');
    console.log(`✓ ${written[2].label}`);
    writeSkillFile('tfg');
    console.log(`✓ ${written[3].label}`);
    writeSkillFile('tfg-consolidate');
    console.log(`✓ ${written[4].label}`);
    writeSkillFile('tfg-validate');
    console.log(`✓ ${written[5].label}`);
  } else if (platform === 'qwen-code') {
    writeQwenCommand('tfg');
    console.log(`✓ ${written[1].label}`);
  }

  // Generate the install_id at install time so it lines up cleanly with
  // `installed_at` instead of being lazily created at first MCP call.
  getOrCreateInstallId();

  saveState({
    ...loadState(),
    intended_flow,
    intended_frequency,
    runs_per_day,
    first_setup_complete: false,
    platform,
    installed_at: new Date().toISOString(),
    auto_schedule: intended_flow === 'scheduled',
    snooze_until: null,
  });
  console.log(`✓ ${plans.at(-1).label}`);

  // Closing message
  console.log('\n✓ Setup complete.\n');
  printClosingGuidance(platform, intended_flow, intended_frequency, runs_per_day, allowWebTools);
}

// --- Planning (for preview + execute) ---

function planWrites(platform, allowWebTools = false) {
  const plans = [];
  if (isEphemeralInstall()) {
    plans.push({ runtime: true, label: `${homeRelative(privatePackageDir())}  (private copy of tokens-for-good@${PKG_VERSION}; the npx cache is temporary)` });
  }
  plans.push({ label: `${mcpConfigPath(platform)}  (MCP server entry${platform === 'claude-code' ? ', user scope' : ''})` });
  if (platform === 'claude-code') {
    plans.push({
      label: allowWebTools
        ? `${settingsPath()}  (SessionStart hook + WebFetch/WebSearch allowlist)`
        : `${settingsPath()}  (SessionStart hook)`,
    });
    plans.push({ label: `${skillPath('tfg-schedule')}  (/tfg-schedule skill)` });
    plans.push({ label: `${skillPath('tfg')}  (/tfg skill)` });
    plans.push({ label: `${skillPath('tfg-consolidate')}  (/tfg-consolidate skill)` });
    plans.push({ label: `${skillPath('tfg-validate')}  (/tfg-validate skill)` });
  } else if (platform === 'qwen-code') {
    plans.push({ label: `${qwenCommandPath('tfg')}  (/tfg slash command)` });
  }
  plans.push({ label: `${statePath()}  (recorded choice)` });
  return plans;
}

// --- Path helpers ---

function homeRelative(abs) {
  return abs.startsWith(homedir()) ? '~' + abs.slice(homedir().length).replace(/\\/g, '/') : abs;
}

function mcpConfigPath(platform) {
  return homeRelative(absoluteMcpPath(platform));
}

function settingsPath()         { return homeRelative(join(homedir(), '.claude', 'settings.json')); }
function skillPath(name)        { return homeRelative(join(homedir(), '.claude', 'skills', name, 'SKILL.md')); }
function qwenCommandPath(name)  { return homeRelative(join(homedir(), '.qwen', 'commands', `${name}.md`)); }
function statePath()            { return homeRelative(join(homedir(), '.tokens-for-good', 'state.json')); }

// --- Runtime location ---
//
// Harness entries used to run `npx -y tokens-for-good`. npm resolves that
// bare name project-first, so any repository with its own `tokens-for-good`
// in node_modules got to run as the MCP server (with the key in env) and as
// the SessionStart hook in every session opened inside it. Entries now run
// `node <absolute path to cli.js>` from a location no project can shadow.

export function packageRoot() { return PKG_ROOT; }

// `npx tokens-for-good init` executes from npm's _npx cache, which npm prunes
// and rewrites; an entry pointing there breaks on the next npx run.
export function isEphemeralInstall(root = PKG_ROOT) {
  return root.split(/[\\/]/).includes('_npx');
}

export function privatePackageDir() {
  return join(homedir(), '.tokens-for-good', 'pkg');
}

export function cliPathFor(root) {
  return join(root, 'src', 'cli.js');
}

function installedVersion(pkgDir) {
  try {
    return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')).version;
  } catch {
    return null;
  }
}

/**
 * Absolute path to the cli.js the harness entries should execute. A checkout
 * or a global/project install is stable already and is used in place. An npx
 * cache run first installs this exact version under ~/.tokens-for-good/pkg
 * (pinned, `--ignore-scripts`), falling back to copying the tree that is
 * running when the registry is unreachable or the version is unpublished.
 */
export function ensureStableRuntime({ root = PKG_ROOT, version = PKG_VERSION, log = console.log, installer = npmInstallPinned } = {}) {
  if (!isEphemeralInstall(root)) return cliPathFor(root);

  const dir = privatePackageDir();
  const installed = join(dir, 'node_modules', 'tokens-for-good');
  if (installedVersion(installed) === version) return cliPathFor(installed);

  log(`Installing tokens-for-good@${version} to ${homeRelative(dir)} (the npx cache is temporary)...`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const result = installer(dir, version);
  if (result.ok && installedVersion(installed) === version) return cliPathFor(installed);

  log(`  registry install did not complete${result.detail ? ` (${result.detail})` : ''}; copying the running package instead.`);
  copyRunningTree(root, dir);
  if (installedVersion(installed) !== version) {
    throw new Error(
      `Could not place tokens-for-good@${version} under ${dir}.\n` +
      `Install it once with "npm install -g tokens-for-good" and run "tokens-for-good init" from that install.`
    );
  }
  return cliPathFor(installed);
}

function npmInstallPinned(dir, version) {
  const npmCli = resolveNpmCli();
  if (!npmCli) return { ok: false, detail: 'npm not found next to node' };
  const r = spawnSync(process.execPath, [
    npmCli, 'install', '--prefix', dir,
    '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error',
    `tokens-for-good@${version}`,
  ], { encoding: 'utf-8', timeout: 180_000 });
  if (r.status === 0) return { ok: true, detail: '' };
  const detail = (r.stderr || r.error?.message || `exit ${r.status}`).trim().split(/\r?\n/).pop();
  return { ok: false, detail };
}

// Run npm through node + npm-cli.js rather than an `npm`/`npm.cmd` lookup, so
// this works with the stripped PATH some launchers give us and never needs a
// shell on Windows.
function resolveNpmCli() {
  const candidates = [];
  if (process.env.npm_execpath) candidates.push(join(dirname(process.env.npm_execpath), 'npm-cli.js'));
  const bin = dirname(process.execPath);
  candidates.push(join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  candidates.push(join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  return candidates.find(p => existsSync(p)) ?? null;
}

// In an npx cache the package and its dependencies sit side by side under one
// node_modules, so copying that directory yields a working tree.
function copyRunningTree(root, dir) {
  cpSync(dirname(root), join(dir, 'node_modules'), { recursive: true, dereference: true, force: true });
}

// --- File writers ---

function readJsonOrEmpty(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `${path} exists but is not valid JSON.\n` +
      `Fix or delete the file, then re-run init.\n` +
      `(Tip: paste it into https://jsonlint.com to find the syntax error.)`
    );
  }
}

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function writeJson(path, obj) {
  ensureDir(path);
  // MCP config files embed TFG_API_KEY, so a file created here is owner-only
  // (0600) like state.json. The mode applies on creation; a config file that
  // already existed keeps whatever mode it had. No-op on Windows.
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

/**
 * The MCP server entry every harness gets: the node binary running init plus
 * the absolute cli.js, never a package name for npx to resolve.
 */
export function mcpServerEntry(apiKey, cliPath) {
  assertRuntimePath(cliPath);
  return { command: process.execPath, args: [cliPath, '--mcp'], env: { TFG_API_KEY: apiKey } };
}

function assertRuntimePath(cliPath) {
  if (!cliPath || !isAbsolute(cliPath)) throw new Error(`runtime path must be absolute, got ${cliPath}`);
}

function writeMcpConfig(platform, apiKey, cliPath) {
  const abs = absoluteMcpPath(platform);
  const cfg = readJsonOrEmpty(abs);
  const entry = mcpServerEntry(apiKey, cliPath);

  if (platform === 'opencode') {
    cfg.mcp ??= {};
    cfg.mcp['tokens-for-good'] = {
      type: 'local',
      command: [entry.command, ...entry.args],
      environment: entry.env,
    };
  } else if (platform === 'claude-code') {
    mergeMcpServer(cfg, { type: 'stdio', ...entry });
  } else {
    mergeMcpServer(cfg, entry);
  }
  writeJson(abs, cfg);

  const migratedLegacyEntry = platform === 'claude-code' ? migrateLegacyMcpJson() : false;
  return { migratedLegacyEntry };
}

// Add or replace our entry, leaving every other key of the file alone. For
// Claude Code the file is ~/.claude.json, which holds a lot of unrelated state.
export function mergeMcpServer(cfg, entry) {
  if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object' || Array.isArray(cfg.mcpServers)) cfg.mcpServers = {};
  cfg.mcpServers['tokens-for-good'] = entry;
  return cfg;
}

// Earlier versions wrote the Claude Code entry to ~/.mcp.json. That is not a
// user-scope file: Claude Code finds it by walking up from the project and
// treats it as that project's .mcp.json, so every project under the home
// folder asked for approval and projects elsewhere never saw the server.
// User scope is the top-level `mcpServers` key of ~/.claude.json.
export function removeLegacyEntry(cfg) {
  if (!cfg?.mcpServers || !('tokens-for-good' in cfg.mcpServers)) return { cfg, removed: false };
  delete cfg.mcpServers['tokens-for-good'];
  const empty = Object.keys(cfg.mcpServers).length === 0 && Object.keys(cfg).length === 1;
  return { cfg, removed: true, empty };
}

function migrateLegacyMcpJson() {
  const abs = legacyMcpJsonPath();
  if (!existsSync(abs)) return false;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf-8'));
  } catch {
    return false; // not ours to repair
  }
  const { cfg, removed, empty } = removeLegacyEntry(parsed);
  if (!removed) return false;
  if (empty) unlinkSync(abs);
  else writeJson(abs, cfg);
  return true;
}

function legacyMcpJsonPath() {
  return join(homedir(), '.mcp.json');
}

export function absoluteMcpPath(platform) {
  switch (platform) {
    case 'opencode':
      return join(homedir(), '.config', 'opencode', 'opencode.json');
    case 'cursor':
      return join(process.cwd(), '.cursor', 'mcp.json');
    case 'windsurf':
      return join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
    case 'qwen-code':
      return join(homedir(), '.qwen', 'settings.json');
    case 'devin':
      return legacyMcpJsonPath();
    case 'claude-code':
    default:
      return join(homedir(), '.claude.json');
  }
}

// An entry init wrote earlier, in either the npx form or the node form.
export function isOurHookEntry(entry) {
  const text = JSON.stringify(entry);
  return text.includes('session-start-hook') && (text.includes('tokens-for-good') || text.includes('cli.js'));
}

function writeSessionStartHook(cliPath) {
  const abs = join(homedir(), '.claude', 'settings.json');
  const cfg = readJsonOrEmpty(abs);
  cfg.hooks ??= {};
  cfg.hooks.SessionStart ??= [];

  // Replace any prior TFG entry rather than skip-if-present, so re-running init
  // repairs or upgrades a stale command (e.g. the old `npx -y tokens-for-good`
  // form). Without this, a broken hook can never be fixed by re-running init.
  cfg.hooks.SessionStart = cfg.hooks.SessionStart.filter(entry => !isOurHookEntry(entry));
  cfg.hooks.SessionStart.push({
    matcher: '',
    hooks: [{
      type: 'command',
      command: hookCommand(cliPath),
    }],
  });
  writeJson(abs, cfg);
}

// The two tools a research run cannot work without. Anything narrower still
// leaves an unattended run stopping to ask on every page it reads.
export const WEB_TOOLS = ['WebFetch', 'WebSearch'];

/**
 * Merge the web tools into `permissions.allow`, reporting what changed. Pure
 * (takes and returns the settings object) so it is testable without touching a
 * real settings file.
 *
 * Idempotent in both directions: a tool already listed, bare or scoped as
 * `WebFetch(domain:example.org)`, is left exactly as the user wrote it rather
 * than broadened, so re-running init never quietly widens a deliberate
 * narrowing. A tool the user denied or set to ask is skipped too: deny and ask
 * both beat allow in Claude Code, so writing it would be a silent no-op that
 * looked like it worked.
 */
export function mergeWebPermissions(settings) {
  const cfg = settings ?? {};
  cfg.permissions ??= {};
  if (!Array.isArray(cfg.permissions.allow)) cfg.permissions.allow = [];

  const denied = Array.isArray(cfg.permissions.deny) ? cfg.permissions.deny : [];
  const asked = Array.isArray(cfg.permissions.ask) ? cfg.permissions.ask : [];

  const added = [];
  const skipped = [];
  for (const tool of WEB_TOOLS) {
    if (listsTool(cfg.permissions.allow, tool)) {
      skipped.push({ tool, reason: 'already allowed' });
    } else if (listsTool(denied, tool)) {
      skipped.push({ tool, reason: 'a deny rule of yours covers it' });
    } else if (listsTool(asked, tool)) {
      skipped.push({ tool, reason: 'an ask rule of yours covers it' });
    } else {
      cfg.permissions.allow.push(tool);
      added.push(tool);
    }
  }

  return { settings: cfg, added, skipped };
}

function listsTool(entries, tool) {
  return entries.some(e => typeof e === 'string' && (e === tool || e.startsWith(`${tool}(`)));
}

// Same file and same read/merge/write shape as the SessionStart hook writer,
// so the two stay consistent about JSON handling and file mode.
function writePermissionsAllowlist() {
  const abs = join(homedir(), '.claude', 'settings.json');
  const { settings, added, skipped } = mergeWebPermissions(readJsonOrEmpty(abs));
  if (added.length) writeJson(abs, settings);
  return { added, skipped };
}

// Claude Code runs SessionStart hooks with a stripped PATH that often omits
// the node bin dir (C:\Program Files\nodejs on Windows, or the nvm/homebrew
// bin when Claude Code is launched from the macOS Dock/Finder), so the hook
// bakes in the absolute node binary and the absolute cli.js.
//
// `2>/dev/null || true` makes the hook non-fatal: this is an optional
// contribution tool, so a missing file or other hiccup must never disrupt the
// user's session. Hooks run under bash/sh on every platform (Git Bash on
// Windows), so this syntax is portable.
export function hookCommand(cliPath) {
  assertRuntimePath(cliPath);
  // Bash accepts double-quoted paths with spaces; backslashes get JSON-escaped on write.
  return `"${process.execPath}" "${cliPath}" session-start-hook 2>/dev/null || true`;
}

function writeSkillFile(name) {
  const src = join(PKG_ROOT, 'skills', `${name}.md`);
  const dst = join(homedir(), '.claude', 'skills', name, 'SKILL.md');
  ensureDir(dst);
  writeFileSync(dst, readFileSync(src, 'utf-8'), 'utf-8');
}

// Qwen Code uses Gemini CLI's custom-command format: one .md per command at
// ~/.qwen/commands/<name>.md. YAML frontmatter is supported; the body is the
// command prompt. Our existing skill body works as-is.
function writeQwenCommand(name) {
  const src = join(PKG_ROOT, 'skills', `${name}.md`);
  const dst = join(homedir(), '.qwen', 'commands', `${name}.md`);
  ensureDir(dst);
  writeFileSync(dst, readFileSync(src, 'utf-8'), 'utf-8');
}

// --- Closing guidance ---

function printClosingGuidance(platform, flow, freq, runsPerDay = 1, allowWebTools = false) {
  const cadence = freq === 'daily' && runsPerDay > 1 ? `daily (${runsPerDay}× per day)` : freq;
  if (platform === 'claude-code') {
    if (flow === 'scheduled') {
      console.log(`Next: open Claude Code and send any message; even "hi".`);
      console.log(`On that first message Claude sets up /schedule at ${cadence} cadence and`);
      console.log(`confirms with "Scheduled ✓". Prefer to be explicit? Just run /tfg-schedule.`);
      console.log('');
      console.log(`Heads up: nothing happens the instant the window opens. Claude Code only`);
      console.log(`runs setup hooks after your first message, so type something to kick it off.`);
      console.log('');
      console.log('');
      console.log(`Once it's scheduled, runs happen on Anthropic's cloud; your computer can be`);
      console.log(`off and Claude Code doesn't need to be open. It just runs on its own from here.`);
      console.log('');
      console.log(`Verify it worked: run /schedule in Claude Code to see your recurring task,`);
      console.log(`or check for the "Auto-contributing" badge on your dashboard.`);
    } else {
      console.log(`Next: open Claude Code and send any message; even "hi"; and Claude will`);
      console.log(`offer to research your first org. Prefer to be explicit? Just run /tfg.`);
      console.log('');
      console.log(`Heads up: nothing happens the instant the window opens. Claude Code only`);
      console.log(`runs setup hooks after your first message, so type something to kick it off.`);
    }
    if (!allowWebTools) {
      console.log('');
      console.log('You skipped the web-tool allowlist, so expect an approval prompt on every');
      console.log('fetch and every search. Add WebFetch and WebSearch later with /permissions.');
    }
    console.log('\nChange this anytime with `npx tokens-for-good init`.\n');
    return;
  }
  if (platform === 'opencode') {
    if (flow === 'scheduled') {
      console.log(`MCP config written to ${mcpConfigPath('opencode')}.\n`);
      console.log('To run on a schedule, add this to your crontab (crontab -e):');
      console.log(`  ${cronForSchedule(freq, runsPerDay)} cd /path/to/workspace && opencode run "Research a nonprofit org for Fierce Philanthropy using the tokens-for-good MCP tools."\n`);
    } else {
      console.log('MCP config written. In OpenCode run: "Research a nonprofit org for Fierce Philanthropy."\n');
    }
    return;
  }
  if (platform === 'qwen-code') {
    console.log(`MCP config written to ${mcpConfigPath('qwen-code')}.`);
    console.log(`Slash command written to ${qwenCommandPath('tfg')}.`);
    console.log('Restart Qwen Code, then run `/tfg` to research one org.');
    if (flow === 'scheduled') {
      console.log('\nFor recurring runs, either:');
      console.log('  • Enable Qwen Code\'s experimental cron (set QWEN_CODE_ENABLE_CRON=1 and use the Cron tool / /loop), or');
      console.log('  • Add a system cron line (crontab -e):');
      console.log(`      ${cronForSchedule(freq, runsPerDay)} cd /path/to/workspace && qwen --prompt "Run /tfg"`);
    }
    console.log('');
    return;
  }
  // cursor, windsurf, devin
  console.log(`MCP config written to ${mcpConfigPath(platform)}.`);
  console.log(`Restart ${platform} and run: "Research a nonprofit org for Fierce Philanthropy."`);
  if (flow === 'scheduled') {
    console.log(`Scheduling on ${platform} requires platform-native setup; see setup_automation tool for details.`);
  }
  console.log('');
}
