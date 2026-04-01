# Step 2: Verify — Claude Code Instructions

## Inputs

- **Org name:** `{{ORG_NAME}}`
- **Research report:** Read from `{{ORG_SLUG}}_Research_Report.md`
- **Research guidance:** Read from `site/research-guidance.md`

## Purpose

Step 1 generated the research report. This step verifies it. You are a fact-checker, not a rewriter. Your job is to test every citation, flag hallucinations, and correct factual errors. Do not change tone, structure, or style.

## Instructions

### 1. Read the Report

Read the full research report. Note every inline citation `[Source Name](URL)` and every factual claim (statistics, percentages, study references, program details).

### 2. Test Every Citation

For each citation in the report, visit the URL using web fetch and verify:

- [ ] **URL loads** — Is it a real page (not 404, not a redirect to a homepage)?
- [ ] **Content matches** — Does the source actually say what the report claims? Quote the relevant passage from the source.
- [ ] **Data is accurate** — Do the numbers in the report match the numbers in the source?

Record each citation check in a table:

| # | Citation | URL Status | Content Match | Notes |
|---|----------|-----------|---------------|-------|

Status values:
- **VALID** — URL loads and content matches
- **BROKEN** — 404, domain not found, or page doesn't load
- **MISMATCH** — URL loads but doesn't support the claim made in the report
- **PARTIAL** — URL loads, some claims match, some don't
- **UNVERIFIABLE** — Paywalled, requires login, or content not accessible

### 3. Check for Hallucinations

Search the web to verify claims that seem suspicious or unusually specific:

- Statistics or percentages that don't appear in any source
- Named studies, RCTs, or evaluations that can't be found
- Program details (founding dates, staff names, locations) that contradict other sources
- Claims about independent evaluations when none exist

### 4. Flag Factual Issues

For each issue found, log it with severity:

- **[SEVERITY: HIGH]** — Wrong numbers, fabricated sources, broken citation URLs, claims contradicted by evidence
- **[SEVERITY: MEDIUM]** — Misleading framing, outdated data, partially supported claims
- **[SEVERITY: LOW]** — Minor inaccuracies, rounding differences, ambiguous wording

### 5. Write Corrections

For each HIGH or MEDIUM issue, write the exact correction:

```
### Correction [N]
**Location:** [First ~10 words of the problematic passage]
**Problem:** [What's wrong]
**Original:** [Exact text to replace]
**Corrected:** [Fixed text]
```

### 6. Apply Corrections and Write Output

Apply all corrections to produce a verified version of the report. Write to:
`{{ORG_SLUG}}_02_Verified.md`

Start the file with a verification log:

```markdown
<!-- Verified: {{ORG_NAME}} | Date: [date] -->

# Verification Log

## Citation Check Results

| # | Citation | URL Status | Content Match | Notes |
|---|----------|-----------|---------------|-------|

## Factual Issues Found

- [List each issue with severity]

## Corrections Applied

- [List each correction made]

## Summary

- Total citations checked: X
- Valid: X | Broken: X | Mismatch: X | Partial: X
- Factual issues: X (High: X, Medium: X, Low: X)
- Corrections applied: X
- Overall accuracy: HIGH / MEDIUM / LOW

---

[Full verified report below]
```

## Quality Checks

Before writing the output:
- [ ] Every citation URL was actually visited and checked
- [ ] The citation table is complete (no citations skipped)
- [ ] All HIGH and MEDIUM issues have written corrections
- [ ] Corrections were applied to the report text
- [ ] No new content was added (only corrections to existing content)
- [ ] The verification log accurately reflects all checks performed
