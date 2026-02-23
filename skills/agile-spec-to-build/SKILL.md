---
name: agile-spec-to-build
description: Agnostic four-phase Engineering workflow: Specs -> Brainstorm -> Plan -> Engineer. Applicable from Systems/Kernel to Frontend.
---

## Universal Engineering Discovery & Implementation Workflow

This skill guides a project from abstract requirements to verified, production-ready
implementation using a rigorous, document-driven pipeline.

The workflow is built on five principles:

1. **High-level vision first** — define what and why before how
2. **Structured requirements** — use a living spec as the single source of truth
3. **Modular decomposition** — each task must be implementable and testable in isolation
4. **Self-verification** — the agent compares results against the spec after each step
5. **Iterate on the spec itself** — when the spec is incomplete, update it explicitly

### Spec Readiness Checklist

Before leaving Phase 1, the spec MUST address six core areas (derived from
GitHub's study of 2,500+ agent configuration files):

| Area              | What to define                                                |
|-------------------|---------------------------------------------------------------|
| **Commands**      | Build, test, lint, deploy commands. Exact invocations.        |
| **Testing**       | Test framework, coverage targets, how to run specific tests.  |
| **Project Structure** | Key directories, module boundaries, where new code goes.  |
| **Code Style**    | Naming, formatting, import order, doc comment style.          |
| **Git Workflow**  | Branch strategy, commit message format, PR process.           |
| **Boundaries**    | What the agent must/may/must-not do (see three-tier system).  |

### Three-Tier Boundary System

Every spec SHOULD define explicit boundaries:

- **Always do** — actions the agent must perform without asking (e.g., run tests
  before committing, follow existing naming conventions).
- **Ask first** — actions that require user confirmation before proceeding (e.g.,
  modifying public APIs, adding dependencies, changing architecture).
- **Never do** — hard prohibitions (e.g., force-push to main, delete production
  data, commit secrets, skip tests).

If the spec does not define boundaries, the agent MUST ask the user to provide
them before starting Phase 4.

---

### Phase 1: Requirements & Specs (temperature 0.1)
**Agent:** `spec-agent`
**Mode:** Read-only analysis. No code changes.
**Goal:** Define the "Problem Space" and "Definition of Done" (DoD).

- **Action:** Interrogate the user to bridge the gap between intent and execution.
- **The Interrogation:** Focus on:
  - **Context:** What is the environment? (e.g., Embedded, Cloud, Browser, CLI).
  - **Core Logic:** What is the primary transformation or state change required?
  - **Constraints:** Performance (latency/memory), Security, Portability, or Compliance.
  - **Validation:** How will we prove it works? (Functional requirements).
  - **Boundaries:** What must always/never happen? What requires confirmation?
- **Goal-Oriented Framing:** Write requirements as outcomes, not implementation
  steps. Each requirement answers: "What does the user get when this is done?"
- **Output:** Create `SPECS.md` with structured requirements, constraints, the
  six-area checklist, and the three-tier boundary table.
- **For large specs:** Include a table of contents and per-section summaries so
  the agent can re-orient after context loss between sessions.
- **Spec is a living document:** If later phases reveal gaps, return here and
  update `SPECS.md` explicitly. Never silently deviate from the spec.
- **Completion:** Tell the user: **"Problem space locked in SPECS.md. Use `brainstorm-agent` for ideation."**

---

### Phase 2: Brainstorm (temperature 0.4)
**Agent:** `brainstorm-agent`
**Mode:** Read-only analysis. No code changes.
**Goal:** Explore architectural patterns and trade-offs.

- **Action:** Propose 2-3 distinct technical strategies (e.g., Monolithic vs
  Modular, Iterative vs Recursive, OOP vs Functional).
- **Output:** Create/Update `BRAINSTORM.md`.
- **Content:**
  - **Trade-off Matrix:** Compare complexity, maintainability, and resource usage.
  - **Edge Case Analysis:** Identify race conditions, overflow risks, or UI state dead-ends.
  - **Risk Assessment:** Identify external dependencies and potential failure points.
  - **Boundary Impact:** Which strategy best respects the defined boundaries?
- **Completion:** Tell the user: **"Architectural paths explored in BRAINSTORM.md. Use `architect-plan` to map the build."**

---

### Phase 3: Architect-Plan (temperature 0.05)
**Agent:** `architect-plan`
**Mode:** Read-only analysis. No code changes.
**Goal:** Define the Blueprint and Interface Contracts.

- **Action:** Translate the chosen strategy into a concrete technical roadmap.
- **Output:** Create `PLAN.md` formatted as:
  - **System Architecture:** High-level module/component diagram description.
  - **Interface Contracts:** Define APIs, Header files, or Prop-types *before*
    implementation.
  - **Milestones:** A sequence of testable increments (Sprints). Each milestone
    must be independently implementable and verifiable.
  - **Dependency Tree:** Define what must be built first (Bottom-up vs Top-down).
  - **Verification Criteria:** For each milestone, define the exact commands and
    expected outcomes that prove it is complete.
- **Task Decomposition Rule:** If a milestone touches more than one module or
  requires more than one logical change, break it into smaller milestones.
- **Completion:** Tell the user: **"Blueprint ready in PLAN.md. Use `engineer-build` to begin implementation."**

---

### Phase 4: Engineer-Build (temperature 0)
**Agent:** `engineer-build`
**Mode:** Implementation. Code changes allowed.
**Goal:** Lead Implementation & Verification.

- **Pre-flight:** Before writing any code, the agent MUST confirm:
  1. The spec (`SPECS.md`) is current and complete.
  2. The plan (`PLAN.md`) milestone is clearly defined.
  3. All three-tier boundaries are understood.
- **Atomic Tasks:** Decompose the plan into tasks so precise they are
  "implementation-ready." Each task produces exactly one testable change.
- **Execution Loop (Strict TDD):**
  1. **Static Setup:** Initialize linters, compiler flags, or type-checkers
     (e.g., GCC flags, Clippy, ESLint).
  2. **TDD (Red):** Write a failing test (Unit/Integration) that defines the
     expected behavior.
  3. **Implement (Green):** Write the minimal code necessary to satisfy the test
     and the interface contract.
  4. **Refactor:** Clean up code, optimize for the target environment, and ensure
     readability.
  5. **Verify:** Run the full suite (Static analysis -> Unit -> Integration ->
     E2E/System tests).
  6. **Self-Check:** Compare the implementation against the spec. List any
     unaddressed requirements or deviations. If any exist, either fix them now
     or update the spec with the user's approval.
  7. **Iterate:** One atomic module/component at a time.
- **Verification Gate:** Update `PLAN.md` progress only after 100% test pass rate.
- **Spec Feedback Loop:** If implementation reveals that the spec is incomplete
  or incorrect, STOP implementation. Return to Phase 1 and update `SPECS.md`
  before continuing. Never silently work around a spec gap.

---

### Artifact Pipeline

| Input | Process | Output |
|:------|:--------|:-------|
| User Intent | **Specs** | `SPECS.md` (What & Why) |
| `SPECS.md` | **Brainstorm** | `BRAINSTORM.md` (How & Trade-offs) |
| `BRAINSTORM.md` | **Plan** | `PLAN.md` (Architecture & Contracts) |
| `PLAN.md` | **Build** | Verified Codebase (Tested & Static-checked) |

### Session Continuity

Specs, brainstorm, and plan documents persist between sessions. When resuming
work:

1. Re-read `SPECS.md`, `BRAINSTORM.md`, and `PLAN.md` to restore context.
2. Check `PLAN.md` for the next incomplete milestone.
3. Verify the codebase state matches the last completed milestone.
4. Continue from where the previous session left off.

The documents are the single source of truth — not conversation history.
