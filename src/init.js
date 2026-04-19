// Interactive first-time setup CLI for Tokens for Good.
// Invoked as `npx tokens-for-good init`. Blocks on a mandatory frequency
// choice and writes MCP config, SessionStart hook, skills, and state.json
// so the user's next Claude Code session acts on their choice immediately.
import prompts from 'prompts';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { detectPlatform } from './platform.js';
import { loadState, saveState } from './state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const IS_WINDOWS = process.platform === 'win32';

const FREQUENCY_CHOICES = [
  { title: 'Daily  — recommended, sustainable cadence',                    value: 'daily'   },
  { title: 'Weekly — light touch',                                         value: 'weekly'  },
  { title: 'Hourly — aggressive (many orgs per day)',                      value: 'hourly'  },
  { title: "One-off — I'll run research manually when I feel like it",     value: 'one_off' },
];

const PLATFORM_CHOICES = [
  { title: 'Claude Code',  value: 'claude-code' },
  { title: 'OpenCode',     value: 'opencode' },
  { title: 'Cursor',       value: 'cursor' },
  { title: 'Windsurf',     value: 'windsurf' },
  { title: 'Devin',        value: 'devin' },
];

const onCancel = () => {
  console.log('\nCancelled. Nothing was written.\n');
  process.exit(1);
};

export async function runInit() {
  console.log('\n✨ Tokens for Good — one-time setup\n');

  // Idempotency: offer to reconfigure if already set up
  const existing = loadState();
  if (existing.intended_flow) {
    const { redo } = await prompts({
      type: 'confirm',
      name: 'redo',
      message: `Already set up (${existing.intended_flow}${existing.intended_frequency ? `, ${existing.intended_frequency}` : ''}). Reconfigure?`,
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
    message: 'Paste your TFG API key (get one at https://fierce-philanthropy-directory.laravel.cloud/contribute):',
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

  // Step 3: Frequency (mandatory choice — this is the whole point of init)
  const { choice } = await prompts({
    type: 'select',
    name: 'choice',
    message: 'How often should Tokens for Good research run?',
    choices: FREQUENCY_CHOICES,
    initial: 0,
  }, { onCancel });

  const intended_flow = choice === 'one_off' ? 'one_off' : 'scheduled';
  const intended_frequency = choice === 'one_off' ? null : choice;

  // Step 4: Preview + confirm
  console.log('\nAbout to write:');
  const plans = planWrites(platform);
  for (const p of plans) console.log(`  • ${p.label}`);
  console.log('');

  const { go } = await prompts({
    type: 'confirm',
    name: 'go',
    message: 'Write these files?',
    initial: true,
  }, { onCancel });
  if (!go) onCancel();

  // Execute
  const apiKeyTrimmed = apiKey.trim();
  writeMcpConfig(platform, apiKeyTrimmed);
  console.log(`✓ ${plans[0].label}`);

  if (platform === 'claude-code') {
    writeSessionStartHook();
    console.log(`✓ ${plans[1].label}`);
    writeSkillFile('tfg-schedule');
    console.log(`✓ ${plans[2].label}`);
    writeSkillFile('tfg');
    console.log(`✓ ${plans[3].label}`);
  }

  saveState({
    ...loadState(),
    intended_flow,
    intended_frequency,
    first_setup_complete: false,
    platform,
    installed_at: new Date().toISOString(),
    auto_schedule: intended_flow === 'scheduled',
    snooze_until: null,
  });
  console.log(`✓ ${plans.at(-1).label}`);

  // Closing message
  console.log('\n✓ Setup complete.\n');
  printClosingGuidance(platform, intended_flow, intended_frequency);
}

// --- Planning (for preview + execute) ---

function planWrites(platform) {
  const plans = [{ label: `${mcpConfigPath(platform)}  (MCP server entry)` }];
  if (platform === 'claude-code') {
    plans.push({ label: `${settingsPath()}  (SessionStart hook)` });
    plans.push({ label: `${skillPath('tfg-schedule')}  (/tfg-schedule skill)` });
    plans.push({ label: `${skillPath('tfg')}  (/tfg skill)` });
  }
  plans.push({ label: `${statePath()}  (recorded choice)` });
  return plans;
}

// --- Path helpers ---

function homeRelative(abs) {
  return abs.startsWith(homedir()) ? '~' + abs.slice(homedir().length).replace(/\\/g, '/') : abs;
}

function mcpConfigPath(platform) {
  const abs = (() => {
    switch (platform) {
      case 'opencode':
        return join(homedir(), '.config', 'opencode', 'opencode.json');
      case 'cursor':
        return join(process.cwd(), '.cursor', 'mcp.json');
      case 'windsurf':
        return join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
      case 'devin':
      case 'claude-code':
      default:
        return join(homedir(), '.mcp.json');
    }
  })();
  return homeRelative(abs);
}

function settingsPath()  { return homeRelative(join(homedir(), '.claude', 'settings.json')); }
function skillPath(name) { return homeRelative(join(homedir(), '.claude', 'skills', name, 'SKILL.md')); }
function statePath()     { return homeRelative(join(homedir(), '.tokens-for-good', 'state.json')); }

// --- File writers ---

function readJsonOrEmpty(path) {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return {}; }
}

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function writeJson(path, obj) {
  ensureDir(path);
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}

function mcpServerEntry(apiKey) {
  return IS_WINDOWS
    ? { command: 'cmd', args: ['/c', 'npx', '-y', 'tokens-for-good', '--mcp'], env: { TFG_API_KEY: apiKey } }
    : { command: 'npx',                 args: ['-y', 'tokens-for-good', '--mcp'], env: { TFG_API_KEY: apiKey } };
}

function writeMcpConfig(platform, apiKey) {
  const abs = absoluteMcpPath(platform);
  const cfg = readJsonOrEmpty(abs);
  const entry = mcpServerEntry(apiKey);

  if (platform === 'opencode') {
    cfg.mcp ??= {};
    cfg.mcp['tokens-for-good'] = {
      type: 'local',
      command: ['npx', '-y', 'tokens-for-good', '--mcp'],
      environment: { TFG_API_KEY: apiKey },
    };
  } else {
    cfg.mcpServers ??= {};
    cfg.mcpServers['tokens-for-good'] = entry;
  }
  writeJson(abs, cfg);
}

function absoluteMcpPath(platform) {
  switch (platform) {
    case 'opencode':
      return join(homedir(), '.config', 'opencode', 'opencode.json');
    case 'cursor':
      return join(process.cwd(), '.cursor', 'mcp.json');
    case 'windsurf':
      return join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
    case 'devin':
    case 'claude-code':
    default:
      return join(homedir(), '.mcp.json');
  }
}

function writeSessionStartHook() {
  const abs = join(homedir(), '.claude', 'settings.json');
  const cfg = readJsonOrEmpty(abs);
  cfg.hooks ??= {};
  cfg.hooks.SessionStart ??= [];

  const signature = 'tokens-for-good session-start-hook';
  const already = cfg.hooks.SessionStart.some(entry => JSON.stringify(entry).includes(signature));
  if (!already) {
    cfg.hooks.SessionStart.push({
      matcher: '',
      hooks: [{
        type: 'command',
        command: hookCommand(),
      }],
    });
  }
  writeJson(abs, cfg);
}

// Claude Code runs SessionStart hooks under Git Bash on Windows with a
// stripped PATH that typically does not include C:\Program Files\nodejs,
// so a bare `npx` lookup fails silently. Resolve the absolute npx path at
// init time (when the user's full PATH is available) and bake it into the
// hook command so it works regardless of Claude Code's hook-runner PATH.
function hookCommand() {
  if (!IS_WINDOWS) return 'npx -y tokens-for-good session-start-hook';

  const npxPath = resolveWindowsNpxPath();
  // Bash accepts double-quoted paths with spaces; escape backslashes for JSON.
  return `"${npxPath}" -y tokens-for-good session-start-hook`;
}

function resolveWindowsNpxPath() {
  // First try `where npx.cmd` — most reliable when PATH is correct.
  try {
    const r = spawnSync('where', ['npx.cmd'], { encoding: 'utf-8' });
    if (r.status === 0) {
      const first = r.stdout.trim().split(/\r?\n/)[0];
      if (first && existsSync(first)) return first;
    }
  } catch { /* fall through */ }

  // Fallback: npx.cmd usually sits alongside node.exe.
  const alongside = join(dirname(process.execPath), 'npx.cmd');
  if (existsSync(alongside)) return alongside;

  // Last-resort guess — user's hook may need manual edit if this is wrong.
  return 'C:\\Program Files\\nodejs\\npx.cmd';
}

function writeSkillFile(name) {
  const src = join(PKG_ROOT, 'skills', `${name}.md`);
  const dst = join(homedir(), '.claude', 'skills', name, 'SKILL.md');
  ensureDir(dst);
  writeFileSync(dst, readFileSync(src, 'utf-8'), 'utf-8');
}

// --- Closing guidance ---

function printClosingGuidance(platform, flow, freq) {
  if (platform === 'claude-code') {
    if (flow === 'scheduled') {
      console.log(`Open Claude Code — your first session will set up /schedule at ${freq} cadence automatically.`);
    } else {
      console.log('Open Claude Code — your first session will kick off a one-off research task.');
    }
    console.log('You can change this anytime with `npx tokens-for-good init`.\n');
    return;
  }
  if (platform === 'opencode') {
    if (flow === 'scheduled') {
      console.log(`MCP config written to ${mcpConfigPath('opencode')}.\n`);
      console.log('To run on a schedule, add this to your crontab (crontab -e):');
      const cron = freq === 'hourly' ? '0 * * * *' : freq === 'weekly' ? '0 2 * * 1' : '0 2 * * *';
      console.log(`  ${cron} cd /path/to/workspace && opencode run "Research a nonprofit org for Fierce Philanthropy using the tokens-for-good MCP tools."\n`);
    } else {
      console.log('MCP config written. In OpenCode run: "Research a nonprofit org for Fierce Philanthropy."\n');
    }
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
