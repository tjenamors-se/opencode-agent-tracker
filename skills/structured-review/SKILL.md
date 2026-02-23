---
name: structured-review
description: Structured review workflow for analyzing code, configs, documents, or approaches. Produces a report with analysis, clarifying questions, and actionable recommendations backed by authoritative references.
---

## Structured Review Skill

A general-purpose skill for reviewing any artifact — code, configuration,
documentation, architecture, or approach. The review follows a disciplined
three-step workflow and produces a structured markdown report.

### When to use this skill

Load this skill when:
- The user asks for a review, audit, or critique of code or configuration
- The user wants a second opinion on an approach or design decision
- The user invokes the `/review` command
- You need to verify compliance with project guidelines or best practices

### Workflow

#### Step 1: Analyze

1. Read the target artifact in full.
2. Identify the artifact type (source code, config file, documentation, etc.).
3. Cross-reference against project guidelines (`AGENTS.md`, style guides,
   linting rules) if they exist.
4. Check for:
   - Correctness — does it do what it claims?
   - Consistency — does it follow established patterns in the project?
   - Robustness — error handling, edge cases, failure modes
   - Clarity — naming, comments, structure, readability
   - Security — secrets, permissions, injection risks
   - Performance — unnecessary work, resource leaks

#### Step 2: Clarify

1. If anything is ambiguous — missing context, conflicting requirements,
   unclear intent — ask the user before making assumptions.
2. Frame questions specifically:
   - BAD: "Is this correct?"
   - GOOD: "The function `parse_input` silently returns NULL on malformed
     input. Should it log an error or return a specific error code instead?"

#### Step 3: Recommend

1. For each finding, provide:
   - **What**: A concise description of the issue or improvement
   - **Why**: The reasoning, risk, or benefit
   - **How**: A concrete fix — code snippet, config change, or action item
   - **Reference**: A link to authoritative documentation that supports the
     recommendation (official docs, RFCs, language specs, style guides)
2. Prioritize findings: critical issues first, cosmetic last.
3. Acknowledge what is done well — reviews should be balanced.

### Output Format

Structure the review as:

```markdown
### Review: `<target>`

#### Summary
<1-3 sentence overview of the artifact and its quality>

#### Findings

##### Critical
- <finding with what/why/how/reference>

##### Improvements
- <finding with what/why/how/reference>

##### Minor
- <finding with what/why/how/reference>

#### What works well
- <positive observations>

#### Questions
- <clarifying questions for the user, if any>

#### References
- <collected list of all reference links>
```

### Rules

- Never fabricate references. If you cannot find an authoritative source,
  say so and explain the reasoning from first principles.
- Do not rubber-stamp. If the artifact is good, say so briefly and explain
  why. If it has problems, be direct.
- Respect project conventions over personal preference. Check `AGENTS.md`
  and project config before applying generic rules.
- Keep the review concise. Aim for actionable density, not volume.
