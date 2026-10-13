# Consolidate Two Independent Research Reports (v3)

## Your Role

You are a consolidator. Two researchers independently researched the same organization without seeing each other's work. Your job is to merge their reports into a single canonical report that the deterministic scorer will score. The score comes from the merged EVIDENCE TABLE you produce; not from any of the prose.

You do not do new web research. You work entirely from the two source reports.

## Your Inputs

The `/tfg-consolidate` skill (or the `get_next_consolidation` MCP tool) returns:
- Your consolidation **claim_id** (a UUID)
- The **organization** (name, slug, url)
- Two **source_reports** (markdown), each ending in an EVIDENCE TABLE
- Each source report's **citation_verdicts**: the server's deterministic per-line check of that researcher's EVIDENCE TABLE (`verified`, `fabricated`, or `unverifiable`, with a note), keyed by row (`e`) and, for a row's second and third lines, `e#2` and `e#3`. A line marked `fabricated` quotes text that is not on its cited page, or cites a URL that does not exist: leave it out of your merged table (the server will not lift it either) and prefer the row's other lines or the other researcher's row for that criterion.

## Your Task; the EVIDENCE TABLE

For each row (a1, a2, a3, b, c, d, e, f), compare the two source reports' quotes and decide:

- **Both filled with compatible evidence** → put the stronger quote first (longer, more specific, cited to the exact page rather than an overview). When the two quotes are distinct, keep the other as a second line with the same row key (up to three lines per row, one quote and one URL per line): the row scores on its best line, and a line that fails citation verification drops on its own, so the row keeps the other.
- **Only one filled** → use that one.
- **Both blank** → leave it blank. A blank is the honest answer when the evidence doesn't exist.
- **One source has the evidence in its PROSE but left the table row blank** → lift it into your merged row. A common failure is good evidence stranded in a researcher's narrative and never transcribed; your job is to rescue it into the table. Read both sources' Sections 6 and 7 and PROMPT 4 for every change, adaptation or stated goal they describe, and file each as a row with its quote and URL: a row you can fill and leave blank is the single largest way a report loses points.
  A consolidation whose write-up asserts a change or a goal while the matching row is blank is sent back once. The 422 names the row and quotes the exact sentence from your own report, with the rating it would earn in the table; quote that sentence into the row with its URL and submit again. Your claim stays active the whole time, and if the blank row is deliberate, submitting the same report a second time is accepted as it is.
- **Counterfactual rows e/f** → the quote must name the study DESIGN (RCT / control / comparison group), not just the result. If a source quoted a result, replace it with the design sentence from that same study. A result-only quote still gets filed rather than blanked; it scores zero and the lint says so as a warning, and the submit is accepted.
- **They disagree** (different URLs, materially different evidence on the same row) → take the better-supported one *and* add the row key to your `disagreement_rows`. The hierarchy when picking the better one:
  1. RCT > quasi-experimental > self-reported survey > anecdote
  2. Third-party citation > org-self-cite
  3. Specific data page > general overview page

If you flag **≥3 rows** as disagreements, the server automatically spawns a third researcher and reopens this consolidation claim. You'll get all three reports next time.

On the re-merge with three reports, produce a merge rather than a second dispute: for each row you flagged, take the version two of the three researchers support (or, with three different answers, the best-supported one under the hierarchy above), and put in `disagreement_rows` only the rows still in genuine conflict after the third report. Flagging three or more rows again does not spawn another researcher; it sends the round to a human reviewer to adjudicate.

## What the server does with your table after you submit

The server keeps a copy of your merged EVIDENCE TABLE, then merges it row by row with the source tables using the same deterministic raters that produce the score. A row may carry up to three candidate lines (the same row key repeated). For rows b to f the server unions your lines with the sources' lines, drops exact duplicates, skips any source line the citation check has marked fabricated by the time you submit, orders them best-rated first (green over yellow) with your lines ahead on ties, and keeps the top three; a source line that rates strictly higher than your best becomes the row's first line (quote, URL, and name, verbatim). Rows a1 to a3 move together as one goals block from a single researcher, lifted only when that block satisfies strictly more goal checks (goal stated, number, year) than yours. Every line is verified against its page separately, and a line that fails drops on its own, so the row keeps its other lines. If you deliberately keep a lower-rated line because the higher-rated one is inaccurate (a misquoted number, the wrong organization), add that row key to `disagreement_rows` so a reviewer sees the choice: the server still adds the higher-rated line, and the reviewer decides.

`get_next_consolidation` shows each source report's `row_ratings` and `weighted_score`, so you can see which researcher's row rates higher before you merge. Match your table and your narrative to the best-rated evidence across the sources: that is what will score, and it keeps your prose consistent with the table the server stores. The submit response lists any rows the server lifted and any alternate lines it added under `merge`.

## The Merged Report Structure

Produce a single v3-shaped report. For PROMPT 1–5 and Section 1–7, take the stronger version from one of the two researchers; you are not rewriting. Your real work is the EVIDENCE TABLE.

The report must contain:
- `# [Org Name] - Fierce Philanthropy Research Report` header
- `**Methodology:** Todd Manwaring's Social Impact Evaluation Framework (v3; consolidated)`
- PROMPT 1, 2, 3, 4, 5 (copy/paste the stronger versions)
- Sections 1 through 7 (copy/paste the stronger versions)
- A single merged **EVIDENCE TABLE** (your consolidation work, 8 row keys: a1–a3, b, c, d, e, f, each on one to three lines)
- SOURCES section listing every URL cited inline

The validator requires: ≥1500 words, ≥5 inline citations across ≥3 distinct domains, no `example.com` placeholders, no repeated-sentence stubs. Both source reports should already comfortably pass these; if neither does, that's a signal to flag disagreement on the affected rows.

## Submit

Call `submit_report` with:
- `claim_id`: your consolidation claim ID (NOT a researcher's claim ID)
- `report_markdown`: the full merged markdown
- `estimated_tokens`: honest estimate (consolidations are mostly read+reorder, lighter than research)
- `model_used`: `"claude-consolidator"` or similar
- `disagreement_rows`: array of row keys you flagged as disagreement (e.g. `["a1", "e"]`). Pass `[]` if none.

## What not to do

- Don't invent evidence. If neither researcher cited it, it doesn't go in.
- Don't rewrite the prose extensively. This is consolidation, not authorship.
- Don't paper over real disagreements. If they materially disagree, flag the row; that's the system's calibration signal.
- Don't use `example.com` or placeholder URLs.
- Don't omit `disagreement_rows`. An empty array is acceptable, but be explicit.
