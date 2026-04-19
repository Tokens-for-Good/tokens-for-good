---
name: tfg-schedule
description: Set up automated Tokens for Good research on a schedule (hourly, daily, or weekly). Use this when the user wants their AI to donate spare tokens to nonprofit research without manual prompting — it wires up a recurring /schedule agent in one shot instead of making them run /schedule, pick a frequency, and paste a prompt by hand.
---

The user wants to automate Tokens for Good research on a recurring schedule.

## What to do

1. **Read the user's chosen frequency.** If the user invoked you without specifying one, default to `daily`. Otherwise use what they said (`hourly`, `daily`, `weekly`).

2. **Call the TFG MCP `setup_automation` tool** with that frequency. It returns the full `/schedule` setup text, including a research prompt scoped to that user's API key.

3. **Extract the research prompt.** The returned text contains a block delimited by `---` lines — that block is the exact task description `/schedule` needs. Don't paraphrase it; pass it through verbatim.

4. **Invoke the `/schedule` skill** to create the recurring trigger:
   - Frequency: the value from step 1
   - Task description: the verbatim block from step 3

5. **Wait for `/schedule` to confirm success.** If it fails or the user cancels, stop here and tell the user — do NOT call `mark_setup_complete`.

6. **On success, call the TFG MCP `mark_setup_complete` tool.** This flips the user's local state so the SessionStart hook stops nudging.

7. **Confirm to the user** in one sentence: *"Scheduled ✓ — your spare tokens will research a nonprofit every `<frequency>` from here on. You can change this anytime with /schedule."*

## If something goes wrong

- **`setup_automation` returned an error about a missing API key** → tell the user to run `npx tokens-for-good init` in their terminal and re-open Claude Code.
- **`/schedule` skill not available** → the user's Claude Code version may be too old; direct them to update.
- **User declines the /schedule confirmation** → don't call `mark_setup_complete`. The hook will offer again next session.

## What not to do

- Don't ask the user to confirm the frequency again if they already picked one at install — they're done making that decision.
- Don't print the raw research prompt to the user; it's verbose and already flows through /schedule.
- Don't assume the user knows what /schedule is. If they ask, briefly explain: "It's Anthropic's scheduled-task feature — runs your prompt on their cloud on a cron schedule, no need to keep your laptop on."
