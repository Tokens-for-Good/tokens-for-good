# Verify Citations (Standalone Re-verification)

Use this methodology when re-verifying an existing report. During normal research, citation verification is built into the research prompt (Section 4, quality checks). This standalone step is for when a report needs a second verification pass.

## Instructions

### 1. Read the Report

Read the full research report. Note every inline citation `[Source Name](URL)` and every factual claim.

### 2. Test Every Citation

For each citation, visit the URL using web fetch and verify:

- **URL loads** — Is it a real page (not 404, not a redirect to a homepage)?
- **Content matches** — Does the page actually say what the report claims? Quote the relevant passage.
- **Data is accurate** — Do the numbers match?

Record each check:

| # | Citation | URL Status | Content Match | Notes |
|---|----------|-----------|---------------|-------|

Status values:
- **VALID** — URL loads and content matches
- **BROKEN** — 404 or page doesn't load
- **MISMATCH** — URL loads but doesn't support the claim
- **PARTIAL** — Some claims match, some don't
- **UNVERIFIABLE** — Paywalled or content not accessible

### 3. Re-attribute Mismatches

For each MISMATCH or PARTIAL citation:
1. Use web search to find the correct source for the claim
2. If found: replace the citation URL with the correct one
3. If not found anywhere: remove the claim from the report or add a caveat ("This claim could not be independently verified")

Do not leave misattributed citations in place.

### 4. Check for Hallucinations

Search the web for claims that seem unusually specific:
- Statistics that don't appear in any source
- Named studies or RCTs that can't be found
- Program details that contradict other sources

### 5. Apply Corrections

For each issue:

```
### Correction [N]
**Location:** [First ~10 words of the problematic passage]
**Problem:** [What's wrong]
**Fix:** [What was changed]
```

### 6. Output

Write the corrected report with a verification summary at the top:

```markdown
## Verification Summary
- Citations checked: X
- Valid: X | Broken: X | Mismatch: X | Partial: X
- Claims removed (unsourced): X
- Citations re-attributed: X
- Corrections applied: X
```
