---
name: tfg-validate
description: Validate two independent v3 research reports by pruning unsupported or fabricated EVIDENCE TABLE rows, using ONLY the cached page text the server provides (no web fetches). Use this when the user has been assigned a validation, OR to check whether they have one pending. Ideal for local models — it does zero scraping.
---

The user wants to validate a pair of independent research reports before they're merged and scored. Under v3 dual-research, every org is researched by two contributors; you (an independent fourth contributor) catch unsupported or fabricated evidence and hand back cleaned-up versions of both reports. The consolidator then merges already-validated tables.

You do **no web research and no fetching**. The server already fetched every cited page and gives you the cached text. This is deliberate — validation is cheap and works on a local model with no scraping budget.

## What to do

1. **Call `get_next_validation` on the TFG MCP.** It returns:
   - the org being validated,
   - your validation `claim_id` (a UUID — submit against this one),
   - two `source_reports` (each a full v3 report with its EVIDENCE TABLE) plus the server's deterministic `citation_verdicts` per row (`verified` / `fabricated` / `unverifiable`),
   - `cached_pages`: the text of every URL cited across both reports, with a `fetch_status` (`ok` / `unreachable` / `non_text` / `missing`),
   - the full validation methodology inline.

   If nothing is assigned, the tool says so — tell the user and stop here.

2. **For each report, go row by row** (a1, a2, a3, b, c, d, e, f). Start from the server's verdict, then apply judgment using the cached page text:
   - **`fabricated`** (quote not on the page, or URL 404s) → **remove the row** (blank quote/URL/name).
   - **`verified`** (quote is on the page) → check it actually **supports the row's criterion**. If on-page but off-target, correct it to a better quote *from the same cached page*, or remove the row. Counterfactual rows e/f must quote the study DESIGN (RCT/control/comparison), not a result.
   - **`unverifiable`** (PDF / unreachable non-404 / missing) → keep only if the report makes it credible; otherwise remove and note why. Don't punish a real PDF just because it can't be auto-read.

3. **The one hard rule:** you may only **SUBTRACT** rows or **CORRECT** a quote to match its cited page. **Never ADD** new evidence, rows, or URLs. A validated report is always a subset (or verbatim-corrected version) of the original. If a report was already clean, leave it unchanged (omit it from your submission).

4. **Call `submit_validation`** with:
   - `claim_id`: your validation claim ID from step 1
   - `validated_reports`: an array of `{ claim_id, report_markdown }` — one entry per report you changed, where `claim_id` is that source report's claim_id and `report_markdown` is its full corrected markdown. Omit reports you didn't change. **If both reports are clean, pass an empty array `[]`** — the round proceeds to consolidation unchanged. Pruning is allowed to drop a report below the usual ≥5-citation / ≥3-domain / ≥1500-word floors; those aren't enforced on a validation.
   - `validation_notes`: a short summary of what you cut/corrected and why
   - `estimated_tokens`: an honest estimate (validation is read-heavy, no web work)

5. **Tell the user what you changed** (e.g. "Validated 2 reports for X: dropped report-1 row f (RCT quote was a result, not a design) and report-2 row c (quote not on the cited page). Consolidation will follow.").

## What not to do

- **Don't add evidence.** Ever. Subtract or correct-to-source only.
- **Don't fetch anything.** Use the `cached_pages` text. A `missing`/`unreachable` page means the citation is unverifiable — don't go find it yourself.
- **Don't punish honest blanks or real PDFs.** A blank row is fine; an `unverifiable` PDF from a credible source can stay.
- **Don't rewrite prose.** Your edits are confined to the EVIDENCE TABLE (and removing now-orphaned SOURCES lines).
- **Don't second-guess a `fabricated` verdict** — the page text is right there; if the quote isn't in it, the row goes.

## If something goes wrong

- **`get_next_validation` returns "no validations assigned"** → there isn't one queued. The user can run `/tfg` to do a fresh research run instead.
- **`submit_validation` says a report is "no longer structurally valid"** → you removed a heading/section, not just evidence. It still needs all PROMPT/Section headings + an EVIDENCE TABLE + SOURCES. Restore the structure and resubmit with the same `claim_id`.
- **`submit_validation` says it "introduces new URLs"** → you added or changed a citation URL. Validation can't add evidence; revert to the original URLs (only remove rows or fix quotes) and resubmit.
- **`submit_validation` says a row's "quote is not on the cited page"** → you rewrote a quote to text the page doesn't contain. Copy the quote verbatim from the cached page text, or remove the row entirely. Resubmit with the same `claim_id`.
- **You referenced a claim_id you weren't given** → only the source `claim_id`s from `get_next_validation` are valid in `validated_reports`. Re-read its output.
- **No cached page text for a citation** → treat that citation as unverifiable; do not fetch it yourself.
