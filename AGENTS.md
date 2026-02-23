# AGENTS.md - Coding Agent Guidelines

This file contains development guidelines for agentic coding assistants working on this TypeScript/OpenCode plugin project.

## Project Overview

**Package**: `@tjenamors.se/opencode-agent-tracker`  
**Language**: TypeScript (strict mode) with ES Modules  
**Target**: Node.js >=18.0.0, ES2022  
**Framework**: OpenCode Plugin System  
**Database**: LMDB (Lightning Memory-Mapped Database)  
**Goal**: High-performance agent tracking for OpenCode

## Build/Lint/Test Commands

### Core Development Commands
```bash
# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Type checking (essential for TypeScript strict mode)
npm run typecheck

# Linting
npm run lint

# Testing with coverage
npm test

# Run specific test file
npm test -- tests/unit/env-protection.test.ts

# Watch mode for tests
npm run test:watch

# Coverage reporting
npm run test:coverage

# Clean build artifacts
npm run clean

# Local plugin testing
npm run test-local

# Setup local symlink
npm run setup-local
```

### Testing Strategy
- **Target**: 80% test coverage minimum (configured in jest.config.cjs)
- **Structure**: Unit tests in `tests/unit/`
- **Pattern**: All new code must include corresponding tests
- **Debug**: Use `npm run test:watch` for development
- **Coverage**: Excludes `index.ts` and `types.ts` from coverage requirements

## Agent Scoring System

### Overview

Agents are tracked by three metrics: **SP** (Skill Points), **XP** (Experience Points),
and **CS** (Communication Score). SP is the primary indicator of agent competence within
its scope. Higher SP means the agent has proven itself and can be trusted with more
autonomy.

### Skill Points (SP)

SP is the main score showing how good the agent is in its scope. Every agent starts
at **1 SP**. SP can only be gained through XP exchange and lost through bug penalties.

**SP exchange:** Spend `10 * current_SP` XP to gain +1.0 SP. Leftover XP is kept.

**SP trust tiers:**

| SP    | Trust Level  | Agent Behavior                                           |
|-------|-------------|----------------------------------------------------------|
| 0-1   | Probation   | Full verification required. Must confirm every action.   |
| 2-3   | Junior      | Standard rules apply. Full retrospectives.               |
| 4-6   | Established | May take initiative on familiar patterns. Less overhead. |
| 7-9   | Senior      | High trust. Minimal confirmation for known work.         |
| 10+   | Expert      | Deep trust earned. Maximum autonomy within scope.        |

**Bug penalty:** SP * 0.5 (halved). XP reset to 0.0. CS * 0.5 (halved).

### Experience Points (XP)

XP is earned through successful work and spent to gain SP.

**XP sources:**

| Event                        | No bugs                  | With bugs                              |
|------------------------------|--------------------------|----------------------------------------|
| Commit                       | +1 XP                   | XP * 0.5 (halved retroactively)        |
| Push                         | +10 XP                  | XP * 0.5 (halved retroactively)        |
| Sprint done                  | +10 XP                  | -1 XP per bug + XP * 0.5              |
| Sprint perfect (0 bugs)      | +100 XP                 | n/a                                    |
| Epic done                    | +100 XP                 | -100 XP (retroactive)                  |
| Semver bump                  | +1000 XP                | -1000 XP + XP * 0.75 (retroactive)    |

**Semver bumps are high-stakes.** The agent must be very careful to reach this
milestone without introducing bugs. The reward is massive but so is the penalty.

### Communication Score (CS)

CS tracks collaboration quality. It is a currency that can be exchanged for XP.

**CS cap:** `SP * 100`. Higher SP unlocks higher CS potential.

**CS grades (after each mini-retrospective):**

| Grade      | Points | When to use                                      |
|------------|--------|--------------------------------------------------|
| Bad        | -1     | Miscommunication, wrong assumptions, wasted work |
| Neutral    | +1     | Acceptable, nothing special, still learning      |
| Good       | +2     | Clear communication, correct execution, smooth   |
| Excellence | +5     | Exceptional alignment, proactive, insightful     |

Both agent and user grade each interaction (so CS changes by -2 to +10 per retrospective).

### CS → XP Exchange

CS is spent (like currency) to gain XP. The exchange rate is based on fibonacci:

**Rate:** `fib(floor(current_CS / 20))` XP per 1.0 CS spent

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

**Exchange rules:**
- All available CS is spent on each exchange (full conversion)
- Exchange is checked automatically after each mini-retrospective
- CS below 20 cannot be exchanged (fib(0) = 0)

### Post-Retrospective Flow

After every mini-retrospective, the following checks run in order:

1. Apply CS grade changes (agent grade + user grade)
2. **CS → XP exchange:** If CS >= 20, spend all CS, gain `CS_spent * fib(floor(CS / 20))` XP
3. **XP → SP exchange:** If XP >= `10 * current_SP`, spend that amount, gain +1.0 SP

### Work Structure

- **Bug fixes** happen outside sprints and epics. No sprint/epic XP for bug work.
- **New features** require new epics and sprints via the agile-spec-to-build workflow:
  - `spec-agent` for requirements discovery (SPECS.md)
  - `brainstorm` for creative exploration (BRAINSTORM.md)
  - `architect-plan` for formal planning (PLAN.md)
  - `engineer-build` for implementation
- Each sprint produces one or more commits. A sprint with zero bugs earns the
  "perfect run" bonus (+100 XP).

### Tracking

SP, XP, and CS are tracked in `.agent/status.json`:

```json
{
  "agent_name": "AgentTracker-Core",
  "skill_points": 0.7,
  "experience_points": 1.0,
  "total_commits": 27.0,
  "total_bugs": 3.0,
  "halted": false,
  "communication_score": 25.7
}
```

All numeric values use 1-decimal floats (`.toFixed(1)`).

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

## Code Style Guidelines

### TypeScript Configuration
The project uses strict TypeScript with comprehensive checks:
```json
{
  "strict": true,
  "noImplicitAny": true,
  "noImplicitReturns": true,
  "noUncheckedIndexedAccess": true,
  "strictNullChecks": true,
  "forceConsistentCasingInFileNames": true
}
```

### Variable Naming
```typescript
const camelCaseVariable = 'value'      // Variables and functions
class PascalCaseClass {}               // Classes
export interface IPascalCaseInterface {} // Interfaces
const UPPER_SNAKE_CASE = 'CONSTANT'    // Constants
```

### Import Organization
```typescript
// External dependencies first
import { open } from 'lmdb'

// Internal modules grouped by functionality
import { EnvProtection } from '../env-protection'
import { TrackingService } from '../tracking-service'

// Type imports (when not used in runtime)
import type { AgentData, PluginConfig } from '../types'
```

### Error Handling Pattern
```typescript
// Always handle errors gracefully with clear messages
try {
  await someOperation()
} catch (error) {
  console.error('Operation failed:', error)
  // Graceful degradation when possible
  return fallbackOption()
}

// Use specific error types when available
if (error instanceof DatabaseError) {
  handleDatabaseError(error)
} else {
  handleGenericError(error)
}
```

### Function Documentation (JSDoc)
```typescript
/**
 * Validates file paths against .env patterns
 * @param filePath - Path to check for .env protection
 * @returns True if file matches .env pattern
 */
private isEnvFile(filePath: string): boolean {
  // Implementation
}
```

### ESLint Rules
The project uses basic ESLint with TypeScript support:
- `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: '^_'`
- `prefer-const` enforced
- `no-var` enforced

## Project-Specific Patterns

### LMDB Database Usage
```typescript
// Use memory-mapped database for performance
import { open } from 'lmdb'

// Database operations should handle errors gracefully
async function storeAgentData(agentId: string, data: AgentData) {
  try {
    await db.put(`agent:${agentId}`, data)
  } catch (error) {
    console.error('Failed to store agent data:', error)
    // Continue without tracking when database fails
  }
}
```

### OpenCode Plugin Integration
```typescript
// Plugin structure expects export and opencode property
import { opencodeHook } from '@opencode-ai/plugin'

export const plugin = {
  name: 'agent-tracker',
  hooks: {
    'tool.execute.before': async (input) => {
      // Plugin logic
    }
  }
}
```

### Environment File Protection
```typescript
// Strict protection against .env file operations
if (tool === 'read' && this.isEnvFile(args.filePath)) {
  throw new Error('Do not read .env files')
}
```

## Naming Conventions

### File Organization
```
src/
├── index.ts              # Main plugin entry point
├── env-protection.ts    # .env file protection system
├── lmdb-database.ts     # LMDB wrapper and database operations
├── tracking-service.ts  # XP/SP and communication score tracking
├── dependency-checker.ts # Plugin dependency validation
└── types.ts            # TypeScript type definitions

tests/
└── unit/               # Unit tests separated by functionality
```

### Key Patterns
- **Prefix-based keys**: `agent:${id}` for database keys
- **Error messages**: Clear, specific error messages for each failure scenario
- **Configuration**: Central configuration via PluginConfig interface

## Development Workflow

### Before Committing Code
- [ ] Run `npm run typecheck` - No TypeScript errors
- [ ] Run `npm run lint` - Linting passes  
- [ ] Run `npm test` - All tests pass
- [ ] Test coverage meets minimum 80% requirement
- [ ] New functionality includes unit tests
- [ ] Documentation updated if API changed

### Code Quality
- Follow existing patterns and style
- Use TypeScript strictly typed approach
- Handle errors gracefully with proper error messages
- Write tests for new functionality
- Maintain 80%+ test coverage

## Plugin-Specific Notes

### Graceful Degradation
The plugin must continue functioning even when LMDB is unavailable:
- Log warnings when degraded mode activated
- Provide basic functionality without tracking
- Never crash OpenCode session

### Data Privacy
- Store data locally only (user's home directory)
- No external API calls or data transmission
- Clear data boundaries between plugin and OpenCode

## Troubleshooting

### Common Issues
- **LMDB not available**: Plugin runs in degraded mode
- **TypeScript errors**: Check `npm run typecheck` output
- **Test failures**: Use `npm run test:coverage` for details
- **Jest ESM issues**: Configured via ts-jest with ESM support

### Debug Commands
```bash
# Check TypeScript issues
npm run typecheck

# Run specific test with debugging
npm run test:watch tests/unit/env-protection.test.ts

# Reset environment
npm run clean && npm test

# Local testing
npm run test-local
```

---

*Remember: This plugin is built for reliability and security. Always prioritize data integrity and graceful error handling.*