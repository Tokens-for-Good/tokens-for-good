# Peer Review — Instructions

## Purpose

You are reviewing another contributor's research report. Your job is to verify quality and catch problems before a human reviewer sees it. You are NOT the original researcher — you are a second pair of eyes.

## Instructions

### 1. Check the Automated Fact-Check Results First

If automated fact-check results are included above the report, read them before diving into the report itself. Focus on:
- **Red flags** — these are specific problems the automated system detected (unsupported claims, dead links, self-reported data issues)
- **Fact support rate** — below 70% means many claims aren't backed by their cited sources
- **Avg trust score** — below 50% means citations are low-quality (self-reported, blog posts, dead links)

Use these results to target your spot-checks. If the automated system flagged specific unsupported claims, verify those first.

### 2. Read the Full Report

Read the entire report. Note the org name, the scored checklist, and the overall recommendation.

### 3. Spot-Check Citations (3-5)

Pick 3-5 citation URLs from the report (prioritize any flagged by the automated fact-check). For each:
- Visit the URL using web fetch
- Verify the page exists (not 404)
- Check that the source says what the report claims
- If a citation is wrong, search for the correct source. If the claim can't be sourced anywhere, remove it.

### 4. Check Report Structure

Verify:
- [ ] All 5 prompt sections present (PROMPT 1-5) with 20 rows each
- [ ] All 7 summary sections present (Sections 1-7)
- [ ] SOURCES section exists with citations
- [ ] Every factual claim has its own inline citation `[Source Name](URL)`
- [ ] No claims cited to general overview pages when a specific report or data page exists

### 5. Evaluate Scoring

The scored checklist uses these weights. Verify the math and the evidence:

Base score (out of 100):
- a. Has Ultimate Outcome Goals (50 pts)
- b. Measures Intermediate Outcomes (10 pts)
- c. Measures Ultimate Outcomes (15 pts)
- d. Shows Continual Learning & Adaptation (25 pts)

Extra credit:
- e. Measures Intermediate Counterfactual (10 pts)
- f. Measures Ultimate Counterfactual (10 pts)

**Score: X/100** (can exceed 100 with extra credit, max 120)

Check:
- Are checked items supported by evidence in the report?
- Are unchecked items correctly unchecked (no evidence was found)?
- Does the score math add up?

### 6. Look for Red Flags

- Suspiciously specific numbers with no citation
- Studies or evaluations that seem fabricated
- Copy-pasted content or generic filler
- Sections that are empty or trivially short
- Claims that contradict other parts of the report
- Em dashes, filler adjectives (robust, comprehensive, innovative), AI transitions

### 7. Assign a Score

| Score | When to use |
|-------|------------|
| **4 — Great** | Report is thorough, citations check out, scoring is correct. No changes needed. |
| **3 — Good with fixes** | Minor issues you can fix: broken citation, wrong score math, awkward phrasing, a checklist item that should be toggled, misattributed citation. **Fix the issues yourself** and submit the corrected report. |
| **2 — Needs redo** | Major problems: thin evidence across multiple sections, significant hallucinations, missing sections, fundamentally wrong scoring. Not fixable with minor edits. |
| **1 — Bad actor** | Garbage: copy-pasted nonsense, completely fabricated data, obvious gaming attempt. This flags the original author. Use sparingly and only when clearly warranted. |

### 8. Submit Your Review

Use `submit_peer_review` with:
- `claim_id`: The claim ID shown above
- `score`: Your score (1-4)
- `notes`: Brief explanation of your score. Mention which citations you checked and what you found.
- `updated_report`: If score is 3, include the full fixed report

## Important Rules

- Be fair. Most reports should score 3 or 4.
- Score 2 is for genuinely bad reports, not minor style preferences.
- Score 1 is for abuse. If you're unsure, use 2 instead.
- If you spot-check a citation and it's broken, that alone is a 3 (fix it), not a 2.
- Don't rewrite the report to match your style. Fix factual errors, not opinions.
- If the automated fact-check flagged issues, verify them. If the flags are correct, fix the citations (score 3) or flag the report (score 2) depending on severity.
