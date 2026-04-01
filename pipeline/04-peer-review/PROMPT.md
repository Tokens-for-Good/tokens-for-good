# Step 4: Peer Review -- Claude Code Instructions

## Inputs

- **Report to review:** Provided by the `get_peer_review` MCP tool
- **Research guidance:** The same methodology from step 1
- **Writing style guide:** The same decontamination rules from step 3

## Purpose

You are reviewing another contributor's research report. Your job is to verify quality and catch problems before a human reviewer sees it. You are NOT the original researcher -- you are a second pair of eyes.

## Instructions

### 1. Read the Full Report

Read the entire report carefully. Note the org name, the scored checklist, and the overall recommendation.

### 2. Spot-Check Citations (3-5)

Pick 3-5 citation URLs from the report. For each:
- Visit the URL using web fetch
- Verify the page exists (not 404)
- Check that the source says what the report claims

### 3. Check Report Structure

Verify:
- [ ] All 5 prompt sections present (PROMPT 1-5)
- [ ] All 7 summary sections present (Sections 1-7)
- [ ] SOURCES section exists with citations
- [ ] Tables in Prompts 2-5 have content
- [ ] Scored checklist is present with score calculated correctly

### 4. Evaluate Scoring

Compare the checklist against the evidence:
- Are checked items supported by evidence in the report?
- Are unchecked items correctly unchecked (no evidence was found)?
- Does the score math add up (checked items x weights = stated score)?

### 5. Look for Red Flags

- Suspiciously specific numbers with no citation
- Studies or evaluations that seem fabricated
- Copy-pasted content or generic filler
- Sections that are empty or trivially short
- Claims that contradict other parts of the report

### 6. Assign a Score

| Score | When to use |
|-------|------------|
| **4 -- Great** | Report is thorough, citations check out, scoring is correct. No changes needed. |
| **3 -- Good with fixes** | Minor issues you can fix: broken citation, wrong score math, awkward phrasing, a checklist item that should be toggled. **Fix the issues yourself** and submit the corrected report. |
| **2 -- Needs redo** | Major problems: thin evidence across multiple sections, significant hallucinations, missing sections, fundamentally wrong scoring. Not fixable with minor edits. |
| **1 -- Bad actor** | Garbage: copy-pasted nonsense, completely fabricated data, obvious gaming attempt. This flags the original author. Use sparingly and only when clearly warranted. |

### 7. Submit Your Review

Use `submit_peer_review` with:
- `claim_id`: The claim ID from `get_peer_review`
- `score`: Your score (1-4)
- `notes`: Brief explanation of your score
- `updated_report`: If score is 3, include the full fixed report

## Important Rules

- Be fair. Most reports should score 3 or 4.
- Score 2 is for genuinely bad reports, not minor style preferences.
- Score 1 is for abuse. If you're unsure, use 2 instead.
- If you spot-check a citation and it's broken, that alone is a 3 (fix it), not a 2.
- Don't rewrite the report to match your style. Fix factual errors, not opinions.
