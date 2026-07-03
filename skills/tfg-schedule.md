---
name: tfg-schedule
description: Set up automated Tokens for Good research on a schedule (daily, with a chosen number of runs per day, or weekly). Use this when the user wants their AI to contribute spare tokens to nonprofit research without manual prompting; it wires up a recurring /schedule agent in one shot instead of making them run /schedule, pick a schedule, and paste a prompt by hand.
---

The user wants to automate Tokens for Good research on a recurring schedule.

## 1. Settle the cadence

Work out the cadence before doing anything else:

- If you were invoked with an explicit cadence (e.g. `frequency=daily`, `runs_per_day=3`) or the user already stated one, use it.
- Otherwise ask the user, offering: **Daily** (recommended), **Weekly** (light touch), or **Skip for now**.
- For a daily cadence with no per-day count set, ask **"How many times per day? (1–15)"**. Claude Code caps how many scheduled runs you get per day, so keep it at 15 or below. Default to 1 if the user has no preference.

Describe cadence by frequency only; keep token costs and dollar amounts out of every question and confirmation.

## 2. Wire it up

1. **Call the TFG MCP `setup_automation` tool** with `frequency` (`daily` or `weekly`) and, for daily, `runs_per_day`. It returns the full `/schedule` setup text: a Step 2 schedule line containing a cron expression, and a self-contained research prompt (methodology embedded) scoped to the user's API key.

2. **Extract the research prompt:** the block delimited by `---` lines. Pass it through verbatim; don't paraphrase or trim it — the embedded methodology sections are the point.

3. **Check for an existing TFG routine, then invoke the `/schedule` skill.** If the user already has a Tokens for Good routine (they're upgrading, or one shows up when listing scheduled tasks), UPDATE that routine in place — replace its task prompt with the new verbatim block and keep its existing cadence unless the user asked to change it. Only create a new routine when none exists. Never leave two TFG routines running.
   - Schedule: the cron expression from `setup_automation`'s Step 2 line (or the existing routine's cadence when upgrading).
   - Task description: the verbatim block from step 2.

4. **Wait for `/schedule` to confirm success.** If it fails or the user cancels, stop here and tell the user; do NOT call `mark_setup_complete`.

5. **On success, call the TFG MCP `mark_setup_complete` tool with `installed_schedule: true`.** This flips the user's local state so the SessionStart hook stops nudging, and records the installed prompt version so upgrade reminders go silent.

6. **Confirm to the user** in one or two sentences, and reassure them it runs unattended, e.g. *"Scheduled ✓; your spare tokens will research a nonprofit on that cadence from here on. It runs on Anthropic's cloud, so your computer can be off and Claude Code doesn't need to be open. Change it anytime with /schedule."* When this was an upgrade of an existing routine, also mention the payoff: the routine no longer fetches instructions from the TFG API at runtime, so scheduled runs stop tripping the prompt-injection security warning.

## If something goes wrong

- **`setup_automation` returned an error about a missing API key** → tell the user to run `npx tokens-for-good init` in their terminal and re-open Claude Code.
- **`/schedule` skill not available** → the user's Claude Code version may be too old; direct them to update.
- **User declines the /schedule confirmation** → don't call `mark_setup_complete`. The hook will offer again next session.

## What not to do

- Keep token costs and dollar figures out of every question and confirmation.
- If the user already picked a cadence at install, don't re-ask it; only ask for the per-day count when it's missing for a daily cadence.
- Don't print the raw research prompt to the user; it's verbose and already flows through /schedule.
- Don't assume the user knows what /schedule is. If they ask, briefly explain: "It's Anthropic's scheduled-task feature; runs your prompt on their cloud on a cron schedule, no need to keep your laptop on."
