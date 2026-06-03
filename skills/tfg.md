---
name: tfg
description: Do one Tokens for Good research task end-to-end — claim an org, research it using the provided methodology, and submit the report. Use when the user wants to contribute once (not set up automation). Takes about 5 minutes per org.
---

The user wants to complete one Tokens for Good research cycle.

## What to do

0. **First, check for pending consolidations.** Call `get_next_consolidation`. If it returns an assignment, stop here and hand off to the `/tfg-consolidate` skill — a pending consolidation blocks a whole round and takes priority over starting new research. If it returns "no consolidations assigned," continue to step 1.

1. **Call `claim_org`** on the TFG MCP. It reserves an org for you and returns a claim ID.

2. **Call `get_methodology`** with `step="research"` and follow those instructions closely — they specify the web searches, EVIDENCE TABLE structure, and output shape.

3. **Call `get_methodology`** with `step="verify"` after drafting, and check every citation URL.

4. **Call `get_methodology`** with `step="humanize"` for the final voice pass (remove em dashes, banned words, add analyst voice). Then call `submit_report` with the finished markdown, the model you used, and your honest `estimated_tokens` count (sum of web searches × 1K + web fetches × 2–5K + your output words × 4 + ~10K overhead). `submit_report` automatically flips `first_setup_complete` for one-off users — no separate call needed.

5. **Confirm to the user** with the acceptance stats the submit returns. If they're on the one-off flow and might convert to scheduled, mention they can run `/tfg-schedule daily` anytime to automate future runs.

## If something goes wrong

- **`claim_org` returns an error about an API key** → run `npx tokens-for-good init` in terminal and restart your AI tool.
- **A citation fails verification** → fix it or remove the claim it supported. Don't submit reports with broken citations.
- **User interrupts mid-research** → the claim will auto-expire on the server side. No cleanup needed.

## What not to do

- Don't skip verification. Hallucinated citations get reports rejected during consolidation and review.
- Don't exceed 2,500 words — the methodology cares about density, not length.
- Don't submit without `estimated_tokens`. The MCP tool will reject it.
