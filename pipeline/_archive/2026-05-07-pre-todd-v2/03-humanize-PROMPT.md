# Step 3: Humanize — Claude Code Instructions

## Inputs

- **Org name:** `{{ORG_NAME}}`
- **Verified report:** The verified report from Step 2 (kept in memory from the previous step)
- **Writing style guide:** The AI decontamination rules below

## Purpose

Step 2 verified the facts. This step makes the report sound human. You are an editor whose only job is to remove AI writing patterns and inject natural voice. Do not change the report structure, tables, checklist items, scores, or citations. Edit the prose only.

## Instructions

### 1. Read the Report and Style Guide

Read the verified report (skip the verification log header, work on the content below the `---`).

The AI decontamination passes below are your checklist.

### 2. Run Each Pass

Work through these checks in order. For each issue found, fix it and log the change.

#### Pass 1: Em Dash Removal
- Search for every `—` (em dash) in the content
- Replace each with a period (two sentences), comma, or parentheses
- Two short sentences almost always beat one em-dashed sentence
- Log count: "Removed X em dashes"

#### Pass 2: Sentence Rhythm
- Flag where 3+ consecutive sentences are roughly the same length (within ~5 words)
- Fix by splitting, combining, or varying structure
- Goal: rhythm should vary when read aloud. Short. Then longer. Then medium.
- Log: "Varied sentence rhythm in X sections"

#### Pass 3: Paragraph Cadence
- Flag sections where consecutive paragraphs follow the same structure (claim then explanation then example, repeated)
- Vary the pattern: lead with evidence sometimes, skip the explanation, open with a question
- Log: "Restructured X paragraphs for cadence variety"

#### Pass 4: Opening Word Diversity
- Scan every paragraph's first word. Flag 2+ consecutive paragraphs starting with the same word
- Common offenders: "The...", "This...", repeated org name, "Pawsperity..." three times in a row
- Rewrite at least one opener in each flagged group
- Log: "Diversified openings in X locations"

#### Pass 5: AI Pattern Scan
Check for and fix:
- [ ] "[Statement]. Not because X — because Y." dramatic structure
- [ ] "Not just X, but Y" emphasis pattern
- [ ] "Whether X or Y" parallel constructions
- [ ] "From X to Y" range statements
- [ ] "Here's the thing" / "Let's dive in" / "In short" / "Put simply" / "The reality is"
- [ ] "At its core" / "At the end of the day" / "Fundamentally" as intensifier
- [ ] "It's worth noting that" / "Importantly" at sentence start
- [ ] Overused dramatic colon reveals
- [ ] Overused semicolons
- Log each pattern found and fixed

#### Pass 6: Perfect Parallelism Breaker
- Find bullet lists where every bullet follows the exact same grammatical structure
- Vary at least one item's structure (not just words)
- Don't always group in threes
- Log: "Broke parallelism in X lists/sections"

#### Pass 7: Filler Adjective Sweep
Search for and remove/replace:
- "seamless," "robust," "comprehensive," "critical," "fundamental," "innovative," "powerful," "unique," "holistic," "cutting-edge," "game-changing," "revolutionary"
- "leverage" → "use", "utilize" → "use"
- Remove minimizers: "simply," "just," "easily"
- Usually the sentence is stronger without the adjective
- Log: "Removed X filler adjectives"

#### Pass 8: Read-Aloud Test
- For each Summary Report section (Sections 1-7), simulate reading aloud
- Flag anything that sounds stilted, overly formal, or robotically even
- Rewrite flagged sentences to sound like a thoughtful analyst explaining to a colleague
- Log: "Rewrote X sentences for natural voice"

#### Pass 9: Voice Injection
Add 2-3 human touches across the Summary Report sections:
- Brief asides showing evaluator judgment ("This is a stronger evidence base than most organizations in this space provide.")
- Concrete contextualization ("To put this in perspective, the WHO considers X to be the threshold for Y.")
- Honest assessments where evidence is ambiguous ("The data here is suggestive but not conclusive.")
- Do NOT overdo this. 2-3 per report max. They should feel like a thoughtful analyst's observations, not a personality transplant.
- Log each injection with location and what was added

### 3. Preserve Report Structure

After all passes, verify you did NOT change:
- [ ] Any markdown heading (##, ###)
- [ ] Any table structure or table data
- [ ] The scored checklist items or their checked/unchecked status
- [ ] The score (X/100)
- [ ] Citation URLs or citation text inside `[brackets](links)`
- [ ] The SOURCES section
- [ ] Section separators (`---`)

### 4. Produce Output

Keep the humanized report in memory. This is the final version that will be submitted via the `submit_report` tool.

Start the output with a change log:

```markdown
<!-- Humanized: {{ORG_NAME}} | Date: [date] -->

# Humanization Log

## Changes by Pass
- **Em dashes:** Removed [X] instances
- **Sentence rhythm:** Varied in [X] sections
- **Paragraph cadence:** Restructured [X] paragraphs
- **Opening diversity:** Fixed [X] locations
- **AI patterns:** Found and fixed: [list each pattern]
- **Parallelism:** Broke in [X] lists/sections
- **Filler adjectives:** Removed [X] ([list them])
- **Read-aloud fixes:** Rewrote [X] sentences
- **Voice injections:** Added [X] ([brief description of each])

## Structure Verification
- [ ] Headings unchanged
- [ ] Tables unchanged
- [ ] Checklist and score unchanged
- [ ] Citations unchanged
- [ ] Sources section unchanged

---

[Full humanized report below]
```

## Quality Checks

Before writing the output:
- [ ] Zero em dashes remain in the content
- [ ] No two consecutive paragraphs start with the same word
- [ ] No AI pattern from the tells list remains
- [ ] At least 2 voice injections added (but no more than 3)
- [ ] Report structure is identical to the input
- [ ] Content reads like a human analyst wrote it
- [ ] The change log accurately reflects all changes made
