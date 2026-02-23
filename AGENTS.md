# AGENTS.md - Coding Agent Guidelines

Guidelines for agentic coding assistants working on this TypeScript/OpenCode plugin.

## Project Overview

| Field       | Value                                          |
|-------------|------------------------------------------------|
| Package     | `@tjenamors.se/opencode-agent-tracker`         |
| Language    | TypeScript (strict mode), ES Modules           |
| Target      | Node.js >=18.0.0, ES2022                       |
| Framework   | OpenCode Plugin System                         |
| Database    | LMDB (Lightning Memory-Mapped Database)        |
| Runtime dep | `lmdb` (only one)                              |

## Commands

```bash
npm run build          # tsc -> dist/
npm run typecheck      # tsc --noEmit (run before every commit)
npm run lint           # eslint src/**/*.ts
npm test               # jest (263 tests, 80% coverage minimum)
npm test -- tests/unit/env-protection.test.ts   # single test file
npm run test:watch     # jest --watch
npm run test:coverage  # jest --coverage
npm run clean          # rm -rf dist coverage
```

**Verification gate** (must pass before every commit):
```bash
npm run typecheck && npm run lint && npm test
```

## Project Structure

```
src/
  index.ts               # Plugin entry, hooks, tools, default export
  types.ts               # All type definitions (single file)
  database.ts            # Database interface (22 methods)
  lmdb-database.ts       # LMDB implementation, 7 sub-databases
  mock-database.ts       # In-memory mock for tests
  tracking-service.ts    # SP/XP/CS scoring, health checks, caching
  write-buffer.ts        # Batched write buffer, monotonic counter keys
  query-service.ts       # Keyword search, scoring, git log fallback
  project-classifier.ts  # AGENTS.md parsing, manifest detection
  health-display.ts      # ASCII health status HUD
  env-protection.ts      # Blocks reads/edits of .env files
  migration.ts           # Per-project -> centralized DB migration
  dependency-checker.ts  # LMDB dependency validation
tests/unit/              # One test file per source module
skills/                  # OpenCode skill definitions (installed by postinstall)
agents/                  # Agent definitions + scoring docs (installed by postinstall)
scripts/postinstall.mjs  # Copies plugin, skills, agents to ~/.config/opencode/
```

## TypeScript Strictness

Key flags beyond `strict: true`:
- `noUncheckedIndexedAccess` -- indexed access returns `T | undefined`
- `exactOptionalPropertyTypes` -- only set optional fields when value is defined
- `noImplicitReturns` -- every code path must return
- `noImplicitOverride` -- override keyword required

## Code Style

**No semicolons** in source files. Test files use semicolons.

### Naming

| Kind            | Convention       | Example                          |
|-----------------|------------------|----------------------------------|
| Variables/funcs | `camelCase`      | `writeBuffer`, `extractAgentId`  |
| Classes         | `PascalCase`     | `LMDBDatabase`, `QueryService`   |
| Interfaces      | `PascalCase`     | `AgentData`, `DatabaseConfig`    |
| Types           | `PascalCase`     | `PluginConfig`, `Grade`          |
| Constants       | `UPPER_SNAKE`    | `DEFAULT_PATH`, `STOP_WORDS`     |
| Files           | `kebab-case.ts`  | `lmdb-database.ts`               |

No `I` prefix on interfaces. No `T` prefix on types.

### Imports

Order: Node builtins, external deps, internal modules, type-only imports.
**All internal imports use `.js` extension** (Node16 module resolution).

```typescript
import { readFileSync } from 'fs'
import { open } from 'lmdb'
import { EnvProtection } from './env-protection.js'
import type { AgentData } from './types.js'
```

### Error Handling

The plugin must **never crash the host**. Every public method catches errors
and returns a safe fallback (`false`, `null`, `[]`).

```typescript
// Prefix unused error params with underscore
catch (_error) { return false }

// Stringify errors with String(), not .message (handles non-Error objects)
result.errors.push(`Failed: ${String(error)}`)

// Guard clauses at method start
if (!this.isAvailable || !this.agentsDB) return null

// Fire-and-forget logging (never await, never throw)
client?.app?.log?.('message')?.catch?.(() => {})
```

### Documentation

JSDoc on all public methods. Use `@param`, `@returns`. Include requirement
refs like `(R1, R3)`. No inline comments explaining what code does.

### ESLint Rules

- `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: '^_'`
- `prefer-const` enforced
- `no-var` enforced

## Testing

- **Framework**: Jest 29 with `babel-jest` (not `ts-jest`)
- **Coverage**: 80% minimum (branches, functions, lines, statements)
- **Excluded from coverage**: `index.ts`, `types.ts`
- **Mock database**: Use `MockDatabase` from `src/mock-database.ts`, not real LMDB
- **Imports in tests**: No `.js` extension (babel handles resolution)
- **LMDB `:memory:` databases share state** across tests in the same suite --
  use unique agent/key IDs per test

Test patterns:
```typescript
import { EnvProtection } from '../../src/env-protection';
// Semicolons in test files, no semicolons in source files

describe('EnvProtection', () => {
  let envProtection: EnvProtection;
  beforeEach(() => { envProtection = new EnvProtection(); });

  it('blocks .env reads', () => {
    // Private method access via bracket notation
    expect(envProtection['isEnvFile']('.env')).toBe(true);
  });
});
```

## Key Architectural Patterns

### Database Abstraction
`Database` interface in `database.ts` with two implementations: `LMDBDatabase`
(production, 7 sub-databases) and `MockDatabase` (tests, in-memory Maps).

### Write Buffering
All mutations go through `WriteBuffer` (monotonic counter keys). Flushed at
session end via `TrackingService.finalizeSession()`. Last-write-wins.

### Prefix-Based Keys
Database keys use prefixes for routing:
`agent:${id}`, `commit:${path}:${hash}`, `communication:${id}:${hash}:${ts}`

### Graceful Degradation
Plugin initializes even when LMDB fails. Every operation checks `db.isAvailable`
first. Database path: `~/.config/opencode/agent-tracker.lmdb` (centralized).

### LMDB Specifics
- `get()` is synchronous (memory-mapped), `put()` returns Promise
- `getRange()` returns synchronous iterator
- `close()` on sub-databases can throw if Dbi already closed -- wrap in try/catch
- `open({ path })` creates path as a file, not directory -- use `dirname()`

## Pre-Commit Checklist

1. `npm run typecheck` passes
2. `npm run lint` passes
3. `npm test` passes (263 tests, 80% coverage)
4. New code has corresponding tests
5. No `.env` files or secrets committed
6. All internal imports use `.js` extension
