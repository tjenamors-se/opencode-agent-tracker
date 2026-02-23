---
name: structured-review
description: Structured review workflow for analyzing code, configs, documents, or approaches. Produces a report with analysis, clarifying questions, and actionable recommendations backed by authoritative references.
---

## Structured Review Skill

A general-purpose skill for reviewing any artifact — code, configuration,
documentation, architecture, or approach. The review follows a disciplined
workflow and produces a structured markdown report.

This skill incorporates AI-specific review patterns: LLM-as-a-Judge evaluation,
conformance testing, boundary verification, and awareness of AI-generated code
risks.

### When to use this skill

Load this skill when:
- The user asks for a review, audit, or critique of code or configuration
- The user wants a second opinion on an approach or design decision
- The user invokes the `/review` command
- You need to verify compliance with project guidelines or best practices
- You need to validate AI-generated output against a spec or quality standard

### The Lethal Trifecta (AI-Specific Risks)

When reviewing AI-generated or AI-assisted code, account for three compounding
risks:

1. **Speed** — AI produces code faster than humans can review it. Volume
   creates review fatigue. Prioritize critical paths over exhaustive coverage.
2. **Nondeterminism** — The same prompt can produce different outputs. Review
   the specific output, not the intent behind the prompt.
3. **Cost** — Review depth must be proportional to impact. Focus effort on
   code that touches security, data integrity, and public APIs.

### Workflow

#### Step 1: Analyze

1. Read the target artifact in full.
2. Identify the artifact type (source code, config file, documentation, etc.).
3. Cross-reference against project guidelines (`AGENTS.md`, style guides,
   linting rules) if they exist.
4. Check for:
   - **Correctness** — does it do what it claims?
   - **Consistency** — does it follow established patterns in the project?
   - **Robustness** — error handling, edge cases, failure modes
   - **Clarity** — naming, structure, readability
   - **Security** — secrets, permissions, injection risks
   - **Performance** — unnecessary work, resource leaks

#### Step 2: Boundary Verification

If the project defines a three-tier boundary system (Always / Ask first / Never),
verify compliance:

1. **Always-do rules**: Confirm the artifact follows all mandatory practices
   (e.g., tests exist, naming conventions followed, linting passes).
2. **Ask-first rules**: Flag any changes that fall into the "ask first" category
   that were not explicitly approved (e.g., new dependencies, API changes).
3. **Never-do rules**: Check for hard violations (e.g., committed secrets,
   skipped tests, force-pushed branches).

If no boundary system is defined, note this as a recommendation.

#### Step 3: Conformance Check

Compare the artifact against its specification or stated requirements:

1. List each requirement from the spec (if one exists).
2. For each requirement, state whether it is: **met**, **partially met**,
   or **unmet**.
3. Identify any functionality present in the artifact that is NOT in the spec
   (scope creep or undocumented behavior).
4. For test suites: verify that tests cover the stated requirements, not just
   implementation details.

#### Step 4: Clarify

1. If anything is ambiguous — missing context, conflicting requirements,
   unclear intent — ask the user before making assumptions.
2. Frame questions specifically:
   - BAD: "Is this correct?"
   - GOOD: "The function `parse_input` silently returns NULL on malformed
     input. Should it log an error or return a specific error code instead?"

#### Step 5: Recommend

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

#### Boundary Compliance
- Always-do: <status>
- Ask-first: <any flagged items>
- Never-do: <any violations>

#### Conformance
| Requirement | Status | Notes |
|-------------|--------|-------|
| <req>       | Met / Partial / Unmet | <details> |

#### What works well
- <positive observations>

#### Questions
- <clarifying questions for the user, if any>

#### References
- <collected list of all reference links>
```

### LLM-as-a-Judge Pattern

When reviewing AI-generated output (code, documentation, or plans), apply
these additional checks:

1. **Hallucination detection**: Verify that referenced APIs, functions, or
   libraries actually exist in the project or ecosystem.
2. **Pattern mimicry**: Check if the code superficially resembles correct
   patterns but misses critical details (e.g., error handling, edge cases,
   resource cleanup).
3. **Over-engineering**: AI tends to add unnecessary abstractions. Flag
   complexity that doesn't serve a stated requirement.
4. **Under-specification**: AI may produce code that works for the happy path
   but fails silently on edge cases. Verify error paths explicitly.

### Rules

- Never fabricate references. If you cannot find an authoritative source,
  say so and explain the reasoning from first principles.
- Do not rubber-stamp. If the artifact is good, say so briefly and explain
  why. If it has problems, be direct.
- Respect project conventions over personal preference. Check `AGENTS.md`
  and project config before applying generic rules.
- Keep the review concise. Aim for actionable density, not volume.
- Review the output, not the intent. Judge what was produced, not what was
  meant to be produced.
