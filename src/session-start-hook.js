// SessionStart hook entry point.
// Invoked as `npx tokens-for-good session-start-hook` from
// ~/.claude/settings.json on every Claude Code session start.
//
// Reads state.json and, if the user's init choice hasn't been acted on yet,
// emits instructions to stdout so Claude sees them as part of the session
// context and acts on the pre-made choice immediately. Exits silently in
// the normal steady state so users aren't nudged forever.
import { loadState, isSnoozed } from './state.js';

export function runSessionStartHook() {
  const state = loadState();

  // Never-initialized users: hook is a no-op. Setup happens via init, not here.
  if (!state.intended_flow) return;

  // First session after init — emit the handoff instruction exactly once.
  if (!state.first_setup_complete) {
    emitFirstSessionInstruction(state);
    return;
  }

  // Steady state: optionally nudge if user is on one-off flow and hasn't
  // contributed in a while. Respects snooze.
  if (isSnoozed()) return;
  if (state.intended_flow === 'one_off' && !state.auto_schedule) {
    const last = state.last_contributed ? new Date(state.last_contributed) : null;
    const daysSince = last ? Math.floor((Date.now() - last.getTime()) / 86_400_000) : Infinity;
    if (daysSince >= 7) {
      process.stdout.write(
        "Tokens for Good: It's been a while — say 'run /tfg' to research one org now, " +
        "or 'run /tfg-schedule daily' to automate it from here on.\n"
      );
    }
  }
}

function emitFirstSessionInstruction(state) {
  const installedOn = state.installed_at
    ? new Date(state.installed_at).toISOString().slice(0, 10)
    : 'recently';

  if (state.intended_flow === 'scheduled') {
    const freq = state.intended_frequency || 'daily';
    process.stdout.write(
      `Tokens for Good: The user ran \`npx tokens-for-good init\` on ${installedOn} ` +
      `and chose scheduled research at ${freq} cadence. This is their first Claude Code ` +
      `session since. Before any other task, invoke the /tfg-schedule skill with ` +
      `frequency=${freq}. After /schedule confirms, the skill will call ` +
      `mark_setup_complete on the TFG MCP to dismiss this prompt.\n`
    );
    return;
  }

  // one_off flow
  process.stdout.write(
    `Tokens for Good: The user ran \`npx tokens-for-good init\` on ${installedOn} ` +
    `and chose to do research manually (one-off, not scheduled). This is their first ` +
    `Claude Code session since. Offer to start a research task now by invoking the ` +
    `/tfg skill. After they submit their first report, the skill will call ` +
    `mark_setup_complete on the TFG MCP to dismiss this prompt.\n`
  );
}
