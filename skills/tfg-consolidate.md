---
name: tfg-consolidate
description: Consolidate two independent v3 research reports into one canonical merged EVIDENCE TABLE that the deterministic scorer will score (v3 dual-research model). Use this when the user has been assigned a consolidation, OR when you want to check whether they have one pending.
---

The user wants to consolidate a pair of independent research reports into one merged report. Under v3 dual-research, every org is researched by two contributors separately; a third contributor (you, here) merges their EVIDENCE TABLEs into one canonical table that the server scores deterministically.

## What to do

1. **Call `get_next_consolidation` on the TFG MCP.** It returns:
   - the org being consolidated,
   - your consolidation `claim_id` (a UUID; this is what you'll submit against, NOT a researcher's claim ID),
   - two `source_reports` (each a full v3 research report ending in an EVIDENCE TABLE),
   - the full consolidation methodology inline.

   If nothing is assigned, the tool says so; tell the user and stop here.

2. **Read both source reports closely.** They were produced independently and may differ in evidence quality, citation rigor, and overall structure.

3. **Merge the EVIDENCE TABLE row by row** (a1, a2, a3, b, c, d, e, f). For each row:
   - If both researchers filled the row with compatible evidence, take the stronger quote (longer, more specific, cites the exact page rather than an overview).
   - If only one filled the row, use that one's quote.
   - If both left it blank, leave it blank; that is an honest signal that the evidence doesn't exist.
   - If they materially disagree (different URLs, different evidence on the same row), take the better-supported one using this hierarchy:
     1. RCT > quasi-experimental > self-reported survey > anecdote
     2. Third-party citation > org-self-cite
     3. Specific data page > general overview page

     AND record the row key in your `disagreement_rows` list.

4. **Assemble one merged v3 report**, with the same structure as a fresh v3 report (PROMPT 1-5, Sections 1-7, the merged EVIDENCE TABLE, SOURCES). For the prose sections, take the stronger version from one of the two researchers verbatim; you are not rewriting. Your real work is the EVIDENCE TABLE.

5. **Call `submit_report`** with:
   - `claim_id`: your consolidation claim ID from step 1
   - `report_markdown`: the merged report
   - `estimated_tokens`: an honest estimate (consolidations are mostly read + reorder; much lighter than fresh research)
   - `model_used`: e.g. `"claude-consolidator"`
   - `disagreement_rows`: array of row keys you flagged (e.g. `["a1", "e"]`). Pass an empty array if none.

6. **Tell the user the org name and your score impression** (e.g. "Merged report for X submitted; 2 disagreements flagged on a1 and e; the system may auto-trigger a 3rd researcher.").

## What not to do

- Don't invent evidence. If neither researcher cited it, it doesn't enter the merged report.
- Don't rewrite the prose extensively. Pick the stronger researcher's version verbatim.
- Don't paper over real disagreements to "keep the count down"; flagging ≥3 rows auto-triggers a 3rd researcher, which is the system's calibration loop. That's a feature, not a failure.
- Don't include `example.com` or placeholder URLs (the validator rejects them).
- Don't omit `disagreement_rows`. An empty array is fine, but be explicit.

## If something goes wrong

- **`get_next_consolidation` returns "no consolidations assigned"** → there isn't a consolidation queued for the user. They can run `/tfg` to do a fresh research run instead.
- **`submit_report` returns validation errors** → fix the merged report (length floor 1500 words, ≥5 citations, ≥3 distinct domains, no placeholder URLs, no repeated-sentence shells) and resubmit using the same `claim_id`.
- **No source reports are returned** → something is off; ask the user to forward the error to the maintainer rather than fabricating reports.
