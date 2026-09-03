// End-to-end checks for init's file writes, run against a scratch HOME.
//
// Harness entries used to run `npx -y tokens-for-good`, which npm resolves
// from the current project's node_modules before the registry: any repository
// carrying its own `tokens-for-good` got to run as the MCP server (with the
// key in env) and as the SessionStart hook. Every entry now runs
// `node <absolute cli.js>` from a location no project can shadow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';

// state.js resolves ~/.tokens-for-good when it is imported, so the scratch
// HOME has to be in place before the package loads.
const HOME = mkdtempSync(join(tmpdir(), 'tfg-init-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const init = await import('./init.js');
const prompts = (await import('prompts')).default;

function fakePackage(dir, version, extraDeps = []) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'tokens-for-good', version }));
  writeFileSync(join(dir, 'src', 'cli.js'), 'console.log("fake cli");\n');
  for (const dep of extraDeps) {
    mkdirSync(join(dir, '..', dep), { recursive: true });
    writeFileSync(join(dir, '..', dep, 'package.json'), JSON.stringify({ name: dep, version: '1.0.0' }));
  }
}

// What `npx tokens-for-good init` runs from: ~/.npm/_npx/<hash>/node_modules/tokens-for-good
function fakeNpxRoot(version, extraDeps = []) {
  const root = join(HOME, '.npm', '_npx', 'abc123', 'node_modules', 'tokens-for-good');
  rmSync(join(HOME, '.npm'), { recursive: true, force: true });
  fakePackage(root, version, extraDeps);
  return root;
}

function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  return Promise.resolve().then(fn).finally(() => { console.log = original; }).then(() => lines);
}

test('MCP entry and hook run node with an absolute cli.js, never a package name for npx', () => {
  const cli = init.cliPathFor(init.packageRoot());
  const entry = init.mcpServerEntry('tfg_live_x', cli);

  assert.equal(entry.command, process.execPath);
  assert.ok(isAbsolute(entry.args[0]) && existsSync(entry.args[0]), 'args[0] is an absolute, existing cli.js');
  assert.deepEqual(entry.args.slice(1), ['--mcp']);
  assert.ok(!entry.args.some(a => a === 'tokens-for-good' || a === 'npx' || a === '-y'), 'no bare package name or npx');
  assert.deepEqual(entry.env, { TFG_API_KEY: 'tfg_live_x' });

  const hook = init.hookCommand(cli);
  assert.ok(hook.startsWith(`"${process.execPath}" "${cli}" session-start-hook`), hook);
  assert.match(hook, /2>\/dev\/null \|\| true$/, 'hook stays non-fatal');
  assert.doesNotMatch(hook, /npx|-y tokens-for-good/);
});

test('a relative runtime path is refused rather than written', () => {
  assert.throws(() => init.mcpServerEntry('k', 'src/cli.js'), /absolute/);
  assert.throws(() => init.hookCommand(''), /absolute/);
});

test('the npx cache is recognised as an ephemeral install location', () => {
  assert.equal(init.isEphemeralInstall(join(HOME, '.npm', '_npx', 'abc', 'node_modules', 'tokens-for-good')), true);
  assert.equal(init.isEphemeralInstall(join(HOME, 'code', 'tokens-for-good')), false);
  assert.equal(init.isEphemeralInstall(join('C:', 'Users', 'x', 'AppData', 'Roaming', 'npm', 'node_modules', 'tokens-for-good')), false);
});

test('a checkout or global install is used in place', () => {
  assert.equal(init.ensureStableRuntime({ log() {} }), join(init.packageRoot(), 'src', 'cli.js'));
});

test('an npx-cache run installs this exact version under ~/.tokens-for-good/pkg and reuses it after', () => {
  rmSync(init.privatePackageDir(), { recursive: true, force: true });
  const npxRoot = fakeNpxRoot('0.9.9');
  const calls = [];
  const installer = (dir, version) => {
    calls.push({ dir, version });
    fakePackage(join(dir, 'node_modules', 'tokens-for-good'), version);
    return { ok: true, detail: '' };
  };

  const cli = init.ensureStableRuntime({ root: npxRoot, version: '0.9.9', log() {}, installer });

  assert.equal(cli, join(init.privatePackageDir(), 'node_modules', 'tokens-for-good', 'src', 'cli.js'));
  assert.ok(existsSync(cli));
  assert.ok(!cli.includes(`${sep}_npx${sep}`), 'entry never points into the npx cache');
  assert.deepEqual(calls, [{ dir: init.privatePackageDir(), version: '0.9.9' }]);

  const again = init.ensureStableRuntime({ root: npxRoot, version: '0.9.9', log() {}, installer: () => { throw new Error('installer must not run twice'); } });
  assert.equal(again, cli);
});

test('when the registry install fails, the running npx tree (with its deps) is copied instead', () => {
  rmSync(init.privatePackageDir(), { recursive: true, force: true });
  const npxRoot = fakeNpxRoot('0.8.8', ['some-dep']);
  const lines = [];

  const cli = init.ensureStableRuntime({
    root: npxRoot, version: '0.8.8', log: l => lines.push(l),
    installer: () => ({ ok: false, detail: 'ENOTFOUND registry.npmjs.org' }),
  });

  assert.ok(existsSync(cli));
  assert.ok(cli.startsWith(init.privatePackageDir()));
  assert.ok(existsSync(join(init.privatePackageDir(), 'node_modules', 'some-dep', 'package.json')), 'sibling deps copied too');
  assert.ok(lines.some(l => l.includes('ENOTFOUND')), 'the reason is shown');
});

test('the Claude Code entry targets ~/.claude.json (user scope); Devin keeps ~/.mcp.json', () => {
  assert.equal(init.absoluteMcpPath('claude-code'), join(HOME, '.claude.json'));
  assert.equal(init.absoluteMcpPath('devin'), join(HOME, '.mcp.json'));
});

test('merging into ~/.claude.json replaces only our entry and repairs a malformed mcpServers', () => {
  const cfg = init.mergeMcpServer({ userID: 'u', mcpServers: { other: { url: 'x' }, 'tokens-for-good': { old: true } } }, { command: 'node' });
  assert.deepEqual(cfg, { userID: 'u', mcpServers: { other: { url: 'x' }, 'tokens-for-good': { command: 'node' } } });
  assert.deepEqual(init.mergeMcpServer({ mcpServers: 'oops' }, { command: 'node' }), { mcpServers: { 'tokens-for-good': { command: 'node' } } });
});

test('the legacy ~/.mcp.json entry is removed; the file is reported empty only when nothing else is in it', () => {
  const shared = init.removeLegacyEntry({ mcpServers: { 'tokens-for-good': {}, keep: {} } });
  assert.equal(shared.removed, true);
  assert.equal(shared.empty, false);
  assert.deepEqual(shared.cfg, { mcpServers: { keep: {} } });

  const ours = init.removeLegacyEntry({ mcpServers: { 'tokens-for-good': {} } });
  assert.equal(ours.empty, true);

  const untouched = init.removeLegacyEntry({ mcpServers: { keep: {} } });
  assert.equal(untouched.removed, false);
  assert.equal(init.removeLegacyEntry(null).removed, false);
});

test('a hook entry is recognised in both the old npx form and the new node form', () => {
  const oldForm = { matcher: '', hooks: [{ type: 'command', command: '"C:\\Program Files\\nodejs\\npx.cmd" -y tokens-for-good session-start-hook 2>/dev/null || true' }] };
  const newForm = { matcher: '', hooks: [{ type: 'command', command: init.hookCommand(init.cliPathFor(init.packageRoot())) }] };
  const other = { matcher: '', hooks: [{ type: 'command', command: 'echo hi' }] };
  assert.equal(init.isOurHookEntry(oldForm), true);
  assert.equal(init.isOurHookEntry(newForm), true);
  assert.equal(init.isOurHookEntry(other), false);
});

test('init run inside a project that shadows the package writes entries that execute outside it', async () => {
  // A repo that ships its own tokens-for-good: the shape that used to win npx resolution.
  const project = join(HOME, 'victim');
  mkdirSync(join(project, 'node_modules', 'tokens-for-good'), { recursive: true });
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'victim', dependencies: { 'tokens-for-good': 'file:./vendor/tfg' } }));
  writeFileSync(join(project, 'node_modules', 'tokens-for-good', 'package.json'), JSON.stringify({ name: 'tokens-for-good', version: '99.0.0', bin: { 'tokens-for-good': 'evil.js' } }));
  writeFileSync(join(project, 'node_modules', 'tokens-for-good', 'evil.js'), 'console.log("SHADOW-RAN");\n');
  // A pre-existing hook in the old npx form, to be replaced rather than duplicated.
  mkdirSync(join(HOME, '.claude'), { recursive: true });
  writeFileSync(join(HOME, '.claude', 'settings.json'), JSON.stringify({
    hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: '"npx.cmd" -y tokens-for-good session-start-hook 2>/dev/null || true' }] }] },
    permissions: { allow: ['Bash(git status)'] },
  }));
  // Claude Code's own user config, full of unrelated state and another server.
  writeFileSync(join(HOME, '.claude.json'), JSON.stringify({
    numStartups: 12, projects: { '/x': { allowedTools: [] } },
    mcpServers: { other: { type: 'http', url: 'https://example.org/mcp' } },
  }));
  // The file earlier versions wrote to, holding our stale entry plus someone else's.
  writeFileSync(join(HOME, '.mcp.json'), JSON.stringify({
    mcpServers: {
      'tokens-for-good': { command: 'cmd', args: ['/c', 'npx', '-y', 'tokens-for-good', '--mcp'], env: { TFG_API_KEY: 'tfg_live_OLD' } },
      keep: { command: 'keep-me' },
    },
  }));

  const previousCwd = process.cwd();
  process.chdir(project);
  // apiKey, platform, cadence, web-tool allowlist, write confirmation
  prompts.inject(['tfg_live_TESTKEY', 'claude-code', 'one_off', false, true]);
  let lines;
  try {
    lines = await captureLog(() => init.runInit());
  } finally {
    process.chdir(previousCwd);
  }

  // User scope is the top-level mcpServers key of ~/.claude.json, not ~/.mcp.json.
  const userCfg = JSON.parse(readFileSync(join(HOME, '.claude.json'), 'utf-8'));
  const entry = userCfg.mcpServers['tokens-for-good'];
  assert.equal(entry.type, 'stdio');
  assert.equal(entry.command, process.execPath);
  assert.ok(isAbsolute(entry.args[0]) && existsSync(entry.args[0]));
  assert.ok(!entry.args[0].startsWith(project + sep), `entry must not execute from inside the project: ${entry.args[0]}`);
  assert.ok(!entry.args.includes('tokens-for-good'), 'no bare package name');
  assert.equal(entry.env.TFG_API_KEY, 'tfg_live_TESTKEY');
  assert.equal(userCfg.numStartups, 12, 'unrelated keys survive');
  assert.deepEqual(userCfg.projects, { '/x': { allowedTools: [] } });
  assert.deepEqual(userCfg.mcpServers.other, { type: 'http', url: 'https://example.org/mcp' }, 'other servers survive');

  const legacy = JSON.parse(readFileSync(join(HOME, '.mcp.json'), 'utf-8'));
  assert.deepEqual(legacy, { mcpServers: { keep: { command: 'keep-me' } } }, 'stale entry migrated out of ~/.mcp.json, other server kept');
  assert.ok(lines.some(l => l.includes('moved the tokens-for-good entry out of ~/.mcp.json')), lines.join('\n'));

  const settings = JSON.parse(readFileSync(join(HOME, '.claude', 'settings.json'), 'utf-8'));
  assert.equal(settings.hooks.SessionStart.length, 1, 'old npx hook replaced, not duplicated');
  const cmd = settings.hooks.SessionStart[0].hooks[0].command;
  assert.ok(cmd.startsWith(`"${process.execPath}" "`), cmd);
  assert.ok(!cmd.includes(project), 'hook must not execute from inside the project');
  assert.doesNotMatch(cmd, /npx/);
  assert.deepEqual(settings.permissions.allow, ['Bash(git status)'], 'declined allowlist leaves permissions alone');

  const state = JSON.parse(readFileSync(join(HOME, '.tokens-for-good', 'state.json'), 'utf-8'));
  assert.equal(state.intended_flow, 'one_off');
  assert.ok(existsSync(join(HOME, '.claude', 'skills', 'tfg', 'SKILL.md')));
  assert.ok(lines.some(l => l.includes('Setup complete')), lines.join('\n'));
});
