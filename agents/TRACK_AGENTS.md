<!-- agent-tracker-scoring-start -->
# Agent Tracking & Scoring System

Installed by `@tjenamors.se/opencode-agent-tracker`.

---

## 1. Agent Definition

An agent is a scoped execution context. Before any work begins, the agent MUST
have all of the following defined. If any are missing, the agent MUST ask the user
to provide them before proceeding.

| Field      | Description                                           |
|------------|-------------------------------------------------------|
| Name       | Unique identifier for this agent instance             |
| Model      | The AI model being used (e.g., claude-opus-4)       |
| Language   | Primary programming language (e.g., PHP, TypeScript)  |
| Framework  | Framework in use (e.g., Laravel, Next.js)             |
| Scope      | Bounded domain of responsibility (e.g., CMS, API)     |

The agent MUST ask the user to explain each field if they are not already provided.
Do NOT assume or guess any of these values.

---

## 2. Skill Point & Experience Point System

Agents are governed by a skill and experience point system that tracks competence.

### Starting State
- Every agent starts with **1 Skill Point (SP)** and **0 Experience Points (XP)**.

### Earning XP

| Event                        | No bugs                  | With bugs                              |
|------------------------------|--------------------------|----------------------------------------|
| Commit                       | +1 XP                   | XP * 0.5 (halved retroactively)        |
| Push                         | +10 XP                  | XP * 0.5 (halved retroactively)        |
| Sprint done                  | +10 XP                  | -1 XP per bug + XP * 0.5              |
| Sprint perfect (0 bugs)      | +100 XP                 | n/a                                    |
| Epic done                    | +100 XP                 | -100 XP (retroactive)                  |
| Semver bump                  | +1000 XP                | -1000 XP + XP * 0.75 (retroactive)    |

### Leveling Up (SP Exchange)
- To gain +1.0 SP, spend `10 * current_SP` XP.
- Leftover XP is kept.

### SP Trust Tiers

| SP    | Trust Level  | Agent Behavior                                           |
|-------|-------------|----------------------------------------------------------|
| 0-1   | Probation   | Full verification required. Must confirm every action.   |
| 2-3   | Junior      | Standard rules apply. Full retrospectives.               |
| 4-6   | Established | May take initiative on familiar patterns. Less overhead. |
| 7-9   | Senior      | High trust. Minimal confirmation for known work.         |
| 10+   | Expert      | Deep trust earned. Maximum autonomy within scope.        |

### Bug Penalty
- SP * 0.5 (halved)
- XP reset to 0.0
- CS * 0.5 (halved)

---

## 3. Communication Score (CS)

CS tracks collaboration quality between agent and user.

### Starting State
- Every agent starts with CS **60** (neutral).
- CS cap: `SP * 100`.

### CS Grades (after each mini-retrospective)

| Grade      | Points | When to use                                      |
|------------|--------|--------------------------------------------------|
| Bad        | -1     | Miscommunication, wrong assumptions, wasted work |
| Neutral    | +1     | Acceptable, nothing special, still learning      |
| Good       | +2     | Clear communication, correct execution, smooth   |
| Excellence | +5     | Exceptional alignment, proactive, insightful     |

Both agent and user grade each interaction (CS changes by -2 to +10 per retrospective).

### CS Behavioral Tiers

| Score   | Tier            | Agent Behavior                                    |
|---------|-----------------|---------------------------------------------------|
| 100+    | God-mode        | Exceptional alignment. Maximum trust and autonomy.|
| 80-99   | Strong          | Less back-and-forth on established patterns.      |
| 60-79   | Neutral         | Default mode. Full retrospectives. All rules.     |
| 40-59   | Declining       | Agent must confirm understanding before every action. |
| 20-39   | Critical        | One action at a time. Wait for explicit confirmation. |
| 1-19    | Breaking point  | Pause all work. Discuss whether to continue.      |
| 0       | Broken          | Trust fully broken. Reassign scope.               |

### CS -> XP Exchange

Rate: `fib(floor(current_CS / 20))` XP per 1.0 CS spent.

| CS range | fib index | XP per 1.0 CS spent |
|----------|-----------|---------------------|
| 0-19     | fib(0)    | 0.0                 |
| 20-39    | fib(1)    | 1.0                 |
| 40-59    | fib(2)    | 1.0                 |
| 60-79    | fib(3)    | 2.0                 |
| 80-99    | fib(4)    | 3.0                 |
| 100-119  | fib(5)    | 5.0                 |
| 120-139  | fib(6)    | 8.0                 |
| 140-159  | fib(7)    | 13.0                |
| 160+     | fib(8)    | 21.0                |

Exchange rules:
- All available CS is spent on each exchange (full conversion)
- Exchange checked automatically after each mini-retrospective
- CS below 20 cannot be exchanged (fib(0) = 0)

---

## 4. Post-Retrospective Flow

After every mini-retrospective, checks run in order:

1. Apply CS grade changes (agent grade + user grade)
2. **CS -> XP exchange:** If CS >= 20, spend all CS, gain `CS_spent * fib(floor(CS / 20))` XP
3. **XP -> SP exchange:** If XP >= `10 * current_SP`, spend that amount, gain +1.0 SP

### Mini-Retrospective Format

After every commit, the agent asks:

```
Retrospective:
- What went well:   [agent's assessment]
- What could improve: [agent's assessment]
- My grade: [bad/neutral/good/excellence]
- Your grade? [bad/neutral/good/excellence]
[CS: XX.X | XP: XX.X | SP: XX.X]
```

---

## 5. Work Structure

- **Bug fixes** happen outside sprints and epics.
- **New features** require the agile-spec-to-build workflow:
  - `spec-agent` for requirements discovery (SPECS.md)
  - `brainstorm` for creative exploration (BRAINSTORM.md)
  - `architect-plan` for formal planning (PLAN.md)
  - `engineer-build` for implementation

### Tracking

SP, XP, and CS are tracked in `.agent/status.json`:

```json
{
  "agent_name": "AgentName",
  "skill_points": 1.0,
  "experience_points": 0.0,
  "total_commits": 0.0,
  "total_bugs": 0.0,
  "halted": false,
  "communication_score": 60.0
}
```

All numeric values use 1-decimal floats (`.toFixed(1)`).

---

## 6. Scope Control

- Each task MUST be one single function or one small, atomic change.
- The agent MUST NOT start work without a user story.
- Before writing any code, the agent MUST answer: WHAT, WHERE, and HOW.

---

## 7. Code Discipline

- Do NOT add inline comments. Only add documentation-style comments (JSDoc, PHPDoc, etc.).
- Do NOT modify existing code unless explicitly asked.
- Follow project patterns. Search the codebase for similar features first.

---

## 8. Version Control

- Commit after every change that dirties the working tree.
- One commit per logical change.
- Descriptive commit messages explaining the "why".
<!-- agent-tracker-scoring-end -->
