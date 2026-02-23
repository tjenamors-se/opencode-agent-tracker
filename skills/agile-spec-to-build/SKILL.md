---
name: agile-spec-to-build
description: Agnostic four-phase Engineering workflow: Specs -> Brainstorm -> Plan -> Engineer. Applicable from Systems/Kernel to Frontend.
---

## Universal Engineering Discovery & Implementation Workflow

This skill guides a project from abstract requirements to verified, production-ready implementation using a rigorous, document-driven pipeline.

### Phase 1: Requirements & Specs (temperature 0.1)
**Agent:** `spec-agent`  
**Goal:** Define the "Problem Space" and "Definition of Done" (DoD).

- **Action:** Interrogate the user to bridge the gap between intent and execution.
- **The Interrogation:** Focus on:
  - **Context:** What is the environment? (e.g., Embedded, Cloud, Browser, CLI).
  - **Core Logic:** What is the primary transformation or state change required?
  - **Constraints:** Performance (latency/memory), Security, Portability, or Compliance.
  - **Validation:** How will we prove it works? (Functional requirements).
- **Output:** Create `SPECS.md` with structured requirements and constraints.
- **Completion:** Tell the user: **"Problem space locked in SPECS.md. Use `brainstorm-agent` for ideation."**

---

### Phase 2: Brainstorm (temperature 0.4)
**Agent:** `brainstorm-agent`  
**Goal:** Explore architectural patterns and trade-offs.

- **Action:** Propose 2-3 distinct technical strategies (e.g., Monolithic vs Modular, Iterative vs Recursive, OOP vs Functional).
- **Output:** Create/Update `BRAINSTORM.md`.
- **Content:** - **Trade-off Matrix:** Compare complexity, maintainability, and resource usage.
  - **Edge Case Analysis:** Identify race conditions, overflow risks, or UI state dead-ends.
  - **Risk Assessment:** Identify external dependencies and potential failure points.
- **Completion:** Tell the user: **"Architectural paths explored in BRAINSTORM.md. Use `architect-plan` to map the build."**

---

### Phase 3: Architect-Plan (temperature 0.05)
**Agent:** `architect-plan`  
**Goal:** Define the Blueprint and Interface Contracts.

- **Action:** Translate the chosen strategy into a concrete technical roadmap.
- **Output:** Create `PLAN.md` formatted as:
  - **System Architecture:** High-level module/component diagram description.
  - **Interface Contracts:** Define APIs, Header files, or Prop-types *before* implementation.
  - **Milestones:** A sequence of testable increments (Sprints).
  - **Dependency Tree:** Define what must be built first (Bottom-up vs Top-down).
- **Completion:** Tell the user: **"Blueprint ready in PLAN.md. Use `engineer-build` to begin implementation."**

---

### Phase 4: Engineer-Build (temperature 0)
**Agent:** `engineer-build`  
**Goal:** Lead Implementation & Verification.

- **Atomic Tasks:** Decompose the plan into tasks so precise they are "implementation-ready."
- **Execution Loop (Strict TDD):**
  1. **Static Setup:** Initialize linters, compiler flags, or type-checkers (e.g., GCC flags, Clippy, ESLint).
  2. **TDD (Red):** Write a failing test (Unit/Integration) that defines the expected behavior.
  3. **Implement (Green):** Write the minimal code necessary to satisfy the test and the interface contract.
  4. **Refactor:** Clean up code, optimize for the target environment, and ensure readability.
  5. **Verify:** Run the full suite (Static analysis -> Unit -> Integration -> E2E/System tests).
  6. **Iterate:** One atomic module/component at a time.
- **Verification:** Update `PLAN.md` progress only after 100% test pass rate.

---

### Artifact Pipeline

| Input | Process | Output |
| :--- | :--- | :--- |
| User Intent | **Specs** | `SPECS.md` (What & Why) |
| `SPECS.md` | **Brainstorm** | `BRAINSTORM.md` (How & Trade-offs) |
| `BRAINSTORM.md` | **Plan** | `PLAN.md` (Architecture & Contracts) |
| `PLAN.md` | **Build** | Verified Codebase (Tested & Static-checked) |
