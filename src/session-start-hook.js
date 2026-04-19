// SessionStart hook entry point.
// Invoked as `npx tokens-for-good session-start-hook` from
// ~/.claude/settings.json on every Claude Code session start.
//
// Reads state.json and, if the user's init choice hasn't been acted on yet,
// emits a JSON payload on stdout in Claude Code's SessionStart-hook format
// so the message is injected into the session's context. Exits silently in
// the normal steady state so users aren't nudged forever.
//
// Docs: https://code.claude.com/docs/en/hooks.md (SessionStart section).
// Required output shape for SessionStart hooks:
//   { "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<text>" } }
// Plain stdout is ignored by Claude Code, which is why this needs JSON.
import { loadState, isSnoozed } from './state.js';

export function runSessionStartHook() {
  const state = loadState();

  // Never-initialized users: hook is a no-op. Setup happens via init, not here.
  if (!state.intended_flow) return;

  // First session after init — emit the handoff instruction exactly once.
  if (!state.first_setup_complete) {
    emit(firstSessionMessage(state));
    return;
  }

  // Steady state: optionally nudge if user is on one-off flow and hasn't
  // contributed in a while. Respects snooze.
  if (isSnoozed()) return;
  if (state.intended_flow === 'one_off' && !state.auto_schedule) {
    const last = state.last_contributed ? new Date(state.last_contributed) : null;
    const daysSince = last ? Math.floor((Date.now() - last.getTime()) / 86_400_000) : Infinity;
    if (daysSince >= 7) {
      emit(
        "Tokens for Good: It's been a while — say 'run /tfg' to research one org now, " +
        "or 'run /tfg-schedule daily' to automate it from here on."
      );
    }
  }
}

function emit(additionalContext) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  }));
}

function firstSessionMessage(state) {
  const installedOn = state.installed_at
    ? new Date(state.installed_at).toISOString().slice(0, 10)
    : 'recently';

  if (state.intended_flow === 'scheduled') {
    const freq = state.intended_frequency || 'daily';
    return (
      `Tokens for Good: The user ran \`npx tokens-for-good init\` on ${installedOn} ` +
      `and chose scheduled research at ${freq} cadence. This is their first Claude Code ` +
      `session since. Before any other task, invoke the /tfg-schedule skill with ` +
      `frequency=${freq}. After /schedule confirms, the skill will call ` +
      `mark_setup_complete on the TFG MCP to dismiss this prompt.`
    );
  }

  // one_off flow
  return (
    `Tokens for Good: The user ran \`npx tokens-for-good init\` on ${installedOn} ` +
    `and chose to do research manually (one-off, not scheduled). This is their first ` +
    `Claude Code session since. Offer to start a research task now by invoking the ` +
    `/tfg skill. After they submit their first report, the skill will call ` +
    `mark_setup_complete on the TFG MCP to dismiss this prompt.`
  );
}
