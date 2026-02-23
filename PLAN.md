# PLAN.md - Implementation Blueprint (R1-R8)

**Date**: 2026-02-23
**Strategy**: B (Sub-database Architecture) from BRAINSTORM.md v2
**Supersedes**: Previous PLAN.md (high-level project overview)

---

## System Architecture

```
Plugin Entry (index.ts)
  │
  ├── DatabaseConfig        (types.ts)
  │     path: resolved via os.homedir()
  │     mapSize: 512MB default
  │
  ├── LMDBDatabase          (lmdb-database.ts)
  │     root environment
  │     ├── agents DB       (sub-db, sharedStructuresKey)
  │     ├── commits DB      (sub-db, sharedStructuresKey)
  │     ├── communication DB (sub-db, sharedStructuresKey)
  │     ├── retrospectives DB (sub-db, sharedStructuresKey)
  │     └── activities DB   (sub-db, sharedStructuresKey)
  │
  ├── WriteBuffer           (write-buffer.ts) NEW
  │     in-memory Map<string, BufferEntry>
  │     flush() -> root.transaction() across all sub-dbs
  │
  ├── TrackingService       (tracking-service.ts)
  │     reads: direct from LMDBDatabase (free)
  │     writes: into WriteBuffer (cheap)
  │     flush: on push / session.deleted
  │     state: getAgentStatus, reportBug, recordCommitGrade
  │     journal: recordRetrospective, logActivity
  │
  ├── Migration             (migration.ts) NEW
  │     detect <cwd>/~/.config/opencode/agent-tracker.lmdb
  │     diff-merge via ifNoExists()
  │
  ├── EnvProtection         (env-protection.ts) UNCHANGED
  └── DependencyChecker     (dependency-checker.ts) UNCHANGED
```

## Interface Contracts

### DatabaseConfig
```typescript
interface DatabaseConfig {
  path?: string        // default: path.join(os.homedir(), '.config', 'opencode', 'agent-tracker.lmdb')
  maxSize?: number     // default: 512 * 1024 * 1024 (512 MB), range: 1MB..2GB
  compression?: boolean // default: true
}
```

### Database (extended)
```typescript
interface Database {
  // Existing
  isAvailable: boolean
  putAgent(agentId: string, data: AgentData): Promise<boolean>
  getAgent(agentId: string): Promise<AgentData | null>
  putCommit(projectPath: string, commitHash: string, data: CommitData): Promise<boolean>
  getCommit(projectPath: string, commitHash: string): Promise<CommitData | null>
  putCommunicationEvent(event: CommunicationScoreEvent): Promise<boolean>
  getCommunicationEvents(agentId: string, limit?: number): Promise<CommunicationScoreEvent[]>
  close(): Promise<void>

  // New (R8)
  putRetrospective(agentId: string, commitHash: string, entry: RetrospectiveEntry): Promise<boolean>
  getRetrospectives(agentId: string, limit?: number): Promise<RetrospectiveEntry[]>
  putActivity(agentId: string, entry: ActivityEntry): Promise<boolean>
  getActivities(agentId: string, limit?: number): Promise<ActivityEntry[]>
}
```

### WriteBuffer
```typescript
class WriteBuffer {
  bufferAgent(agentId: string, data: AgentData): void
  bufferCommit(projectPath: string, commitHash: string, data: CommitData): void
  bufferCommunicationEvent(event: CommunicationScoreEvent): void
  bufferRetrospective(agentId: string, commitHash: string, entry: RetrospectiveEntry): void
  bufferActivity(agentId: string, entry: ActivityEntry): void
  flush(db: LMDBDatabase): Promise<FlushResult>
  clear(): void
  get size(): number
  get isEmpty(): boolean
}

interface FlushResult {
  entriesWritten: number
  errors: string[]
}
```

### Grade & New Types
```typescript
type Grade = -1 | 1 | 2 | 5

interface RetrospectiveEntry {
  commit: string
  timestamp: string
  task: string
  agent_grade: Grade
  user_grade: Grade
  score_before: number
  score_after: number
  agent_note: string
  user_note: string
}

interface ActivityEntry {
  timestamp: string
  task: string
  actions: string
  outcome: string
  decisions: string
}

interface AgentStatus {
  id: string
  skill_points: number
  experience_points: number
  communication_score: number
  total_commits: number
  total_bugs: number
  halted: boolean
  active: boolean
}

interface MigrationResult {
  entriesMigrated: number
  entriesSkipped: number
  errors: string[]
}
```

---

## Milestones

Each milestone is a testable increment. One commit per milestone.

### Sprint 1: Database foundation (R1, R2, R3)
Fix the database layer. Everything else depends on this.

#### M1: types.ts -- add DatabaseConfig, Grade, new types
- [ ] Add `DatabaseConfig` interface
- [ ] Add `Grade` type (`-1 | 1 | 2 | 5`)
- [ ] Add `RetrospectiveEntry` interface
- [ ] Add `ActivityEntry` interface
- [ ] Add `AgentStatus` interface
- [ ] Add `MigrationResult` interface
- [ ] Add `FlushResult` interface
- [ ] Update `CommunicationScoreEvent.grade` to use `Grade` type
- [ ] Remove unused `TrackingServiceOptions`, `DatabaseInterface`
- [ ] Add `maxDatabaseSize` to `PluginConfig`
- **Test**: `npm run typecheck` passes
- **Commit**: one commit

#### M2: database.ts -- extend Database interface
- [ ] Add `putRetrospective`, `getRetrospectives` to interface
- [ ] Add `putActivity`, `getActivities` to interface
- **Test**: `npm run typecheck` passes
- **Commit**: one commit

#### M3: lmdb-database.ts -- path resolution, mapSize, sub-databases
- [ ] Import `os`, `path`, `fs` from Node.js
- [ ] Accept `DatabaseConfig` in constructor instead of raw string
- [ ] Guard `:memory:` path (skip resolution for test mode)
- [ ] Resolve default path via `os.homedir()` + `path.join()`
- [ ] Resolve relative custom paths against `os.homedir()`
- [ ] Create parent directories with `fs.mkdirSync({ recursive: true })`
- [ ] Validate `mapSize` (1 MB..2 GB), throw on invalid
- [ ] Pass `mapSize` to `open()`
- [ ] Enable `sharedStructuresKey` per sub-db
- [ ] Open 5 named sub-databases: agents, commits, communication, retrospectives, activities
- [ ] Set `maxDbs: 10` on root
- [ ] Refactor `putAgent`/`getAgent` to use `agents` sub-db (no prefix)
- [ ] Refactor `putCommit`/`getCommit` to use `commits` sub-db (no prefix)
- [ ] Refactor `putCommunicationEvent`/`getCommunicationEvents` to use `communication` sub-db (no prefix)
- [ ] Implement `putRetrospective`/`getRetrospectives` on `retrospectives` sub-db
- [ ] Implement `putActivity`/`getActivities` on `activities` sub-db
- [ ] Add `implements Database` to class declaration
- [ ] Close all sub-dbs in `close()`
- **Test**: update `tests/unit/lmdb-database.test.ts`
  - Path resolution tests (default, custom absolute, custom relative, `:memory:`)
  - mapSize validation tests (valid, too small, too large, negative)
  - Sub-database CRUD for all 5 types
  - Existing tests adapted (no behavior change, just internal structure)
- **Commit**: one commit

#### M4: mock-database.ts -- match extended interface
- [ ] Add `implements Database`
- [ ] Add `putRetrospective`/`getRetrospectives` (Map-based)
- [ ] Add `putActivity`/`getActivities` (Map-based)
- [ ] Add `clear()` support for new maps
- **Test**: existing tests still pass
- **Commit**: one commit

### Sprint 2: Write buffer (R6)
Decouple writes from hooks.

#### M5: write-buffer.ts -- new file
- [ ] Create `WriteBuffer` class
- [ ] Internal storage: `Map<string, { type: 'agent' | 'commit' | 'communication' | 'retrospective' | 'activity', data: unknown, meta: Record<string, string> }>`
- [ ] `bufferAgent(agentId, data)` -- stores under key `agent:<agentId>`
- [ ] `bufferCommit(projectPath, commitHash, data)` -- stores under key `commit:<projectPath>:<commitHash>`
- [ ] `bufferCommunicationEvent(event)` -- stores under key `communication:<agentId>:<commitHash>:<timestamp>`
- [ ] `bufferRetrospective(agentId, commitHash, entry)` -- stores under key `retrospective:<agentId>:<commitHash>`
- [ ] `bufferActivity(agentId, entry)` -- stores under key `activity:<agentId>:<timestamp>`
- [ ] `flush(db)` -- calls `db.root.transaction()`, iterates buffer, routes each entry to the correct sub-db `put()`, returns `FlushResult`
- [ ] `clear()` -- empties the buffer
- [ ] `size` / `isEmpty` getters
- [ ] Duplicate key writes: last-write-wins (Map naturally handles this)
- **Test**: `tests/unit/write-buffer.test.ts` (new file)
  - Buffer entries, verify size
  - Flush to MockDatabase, verify data written
  - Duplicate key collapse
  - Empty buffer flush (no-op)
  - Flush error handling (partial failure)
- **Commit**: one commit

#### M6: tracking-service.ts -- switch to buffered writes
- [ ] Fix existing type error: import `Database` interface, type `db` as `Database` not `LMDBDatabase`
- [ ] Accept `WriteBuffer` as constructor parameter
- [ ] Change `incrementXP` to: read agent from db, mutate in memory, buffer result
- [ ] Change `incrementCommitCount` to: read agent, mutate, buffer
- [ ] Change `updateCommunicationScore` to: read agent, mutate, buffer
- [ ] Change `commitCompleted` to: buffer commit + agent mutations (one read, one buffer)
- [ ] Change `recordCommunicationScore` to: buffer event + agent mutation
- [ ] Change `createAgent` to: buffer new agent (no immediate write)
- [ ] Collapse multiple agent mutations per session: read once, apply all increments in memory, buffer final state
- [ ] Add `flushWriteBuffer(): Promise<FlushResult>` -- delegates to `writeBuffer.flush(db)`
- [ ] Update `recordCommunicationScore` to accept `Grade` type (includes `5`)
- [ ] Add `getAgentStatus(agentId)` (R8.1) -- reads from db, returns `AgentStatus`
- [ ] Add `reportBug(agentId)` (R8.1) -- reads agent, decrements SP, checks halt, buffers
- [ ] Add `recordCommitGrade(agentId, commitHash, agentGrade, userGrade)` (R8.2) -- applies both grades, buffers
- [ ] Add `recordRetrospective(entry)` (R8.2) -- buffers to retrospectives
- [ ] Add `logActivity(agentId, entry)` (R8.3) -- buffers to activities
- [ ] Remove `finalizeSession` direct write, replace with `flushWriteBuffer` call
- **Test**: update `tests/unit/tracking-service.test.ts`
  - Verify no direct db writes from hook methods
  - Verify buffer contains expected entries after hook calls
  - Verify flush writes all buffered data
  - Verify agent state reads work (getAgentStatus)
  - Verify reportBug decrements SP, halts at 0
  - Verify recordCommitGrade applies both grades
  - Verify Grade 5 (excellence) is accepted
  - Un-skip previously skipped tests where applicable
- **Commit**: one commit

### Sprint 3: Plugin wiring & migration (R3, R4, R6, R8)
Connect everything in index.ts and add migration.

#### M7: index.ts -- wire config, buffer, flush, new methods
- [ ] Read `PluginConfig` from context (or use defaults)
- [ ] Pass `DatabaseConfig` to `LMDBDatabase` constructor
- [ ] Create `WriteBuffer` instance, pass to `TrackingService`
- [ ] Wire `session.deleted` to call `trackingService.flushWriteBuffer()`
- [ ] Wire push event (if available in OpenCode hooks) to call `trackingService.flushWriteBuffer()`
- [ ] Run migration on startup (after db init, before hooks)
- **Test**: update `tests/unit/plugin.test.ts`
- **Commit**: one commit

#### M8: migration.ts -- new file
- [ ] `migrateFromProjectDatabase(sourceDir: string, targetDb: LMDBDatabase): Promise<MigrationResult>`
- [ ] Detect source at `path.join(sourceDir, '~', '.config', 'opencode', 'agent-tracker.lmdb')`
- [ ] Open source as a flat LMDB (old prefix-based format)
- [ ] Read all keys via `getRange()`
- [ ] Parse key prefixes (`agent:`, `commit:`, `communication:`) to route to target sub-dbs
- [ ] Use `ifNoExists()` on target sub-db for each entry (idempotent)
- [ ] Count migrated vs skipped entries
- [ ] Close source DB after migration
- [ ] Catch all errors, return them in `MigrationResult.errors`
- [ ] Never throw -- always return a result
- **Test**: `tests/unit/migration.test.ts` (new file)
  - Migration with source data -> entries appear in target
  - Migration idempotency (run twice, same result)
  - Migration with no source DB (no-op, no error)
  - Migration with partially overlapping data (only diffs migrate)
  - Migration error handling (source locked, corrupt)
- **Commit**: one commit

### Sprint 4: Documentation & cleanup (R5)

#### M9: README.md -- configuration docs
- [ ] Add Configuration section
- [ ] Document `databasePath` option with default value
- [ ] Document `maxDatabaseSize` option with default and range
- [ ] Add example OpenCode config snippet
- [ ] Update features list to reflect new capabilities
- **Commit**: one commit

#### M10: Final cleanup
- [ ] Remove unused types (`TrackingServiceOptions`, `DatabaseInterface`)
- [ ] Run `npm run typecheck` -- zero errors
- [ ] Run `npm run lint` -- zero warnings
- [ ] Run `npm test` -- all pass, coverage >= 80%
- [ ] Verify no `.agent/status.json` or `.journal/` files are written by shell commands in normal operation
- **Commit**: one commit

---

## Dependency Tree

```
M1 (types) ─┬─> M2 (database interface) ──> M3 (lmdb-database) ──> M4 (mock-database)
             │                                        │
             └─> M5 (write-buffer) ──────────────────>│
                                                      v
                                              M6 (tracking-service)
                                                      │
                                              M7 (index.ts wiring)
                                                      │
                                              M8 (migration)
                                                      │
                                              M9 (README)
                                                      │
                                              M10 (cleanup)
```

Build order: M1 -> M2 -> M3 -> M4 -> M5 -> M6 -> M7 -> M8 -> M9 -> M10

M5 (write-buffer) can be developed in parallel with M3/M4 since it only depends on M1 types. But for commit hygiene, sequential order is safer.

---

## Verification per Milestone

Every milestone MUST pass before proceeding to the next:

| Check | Command |
|-------|---------|
| Types compile | `npm run typecheck` |
| Lint passes | `npm run lint` |
| Tests pass | `npm test` |
| Coverage | `npm run test:coverage` (>= 80%) |

---

**Blueprint ready. Use `engineer-build` to begin implementation.**

---

# PLAN: NPM Postinstall Setup (R9)

**Date**: 2026-02-23
**Strategy**: B (Modular .mjs script) from BRAINSTORM.md R9

---

## System Architecture

```
npm install @tjenamors.se/opencode-agent-tracker
  │
  └── postinstall (scripts/postinstall.mjs)
        │
        ├── copyPlugin()          R9.1
        │     src: <package>/dist/
        │     dst: ~/.config/opencode/plugins/agent-tracker/
        │     behavior: always overwrite
        │
        ├── installSkills()       R9.2
        │     src: <package>/skills/
        │     dst: ~/.config/opencode/skills/
        │     behavior: skip if dir exists
        │
        ├── installAgents()       R9.3
        │     src: <package>/agents/agents.json
        │     dst: ~/.config/opencode/opencode.json (merge)
        │     behavior: skip if agent key exists
        │
        ├── registerPlugin()      R9.4
        │     dst: ~/.config/opencode/opencode.json (plugin array)
        │     behavior: add if not present, remove stale file:// paths
        │
        └── installAgentsMd()     R9.5
              src: <package>/agents/TRACK_AGENTS.md
              dst: ~/.config/opencode/AGENTS.md
              behavior: merge if exists, create if not
```

## Bundled Assets to Create

### M11: Bundle skills into repo
Copy the two skill files into the npm package source tree:
- `skills/agile-spec-to-build/SKILL.md` (from `~/.config/opencode/skills/agile-spec-to-build/SKILL.md`)
- `skills/structured-review/SKILL.md` (from `~/.config/opencode/skills/structured-review/SKILL.md`)

**Verification**: Files exist in repo, git status clean.

### M12: Bundle agent definitions
Create `agents/agents.json` with the 4 agent definitions extracted from `~/.config/opencode/opencode.json`:
```json
{
  "spec-agent": { ... },
  "brainstorm": { ... },
  "architect-plan": { ... },
  "engineer-build": { ... }
}
```

**Verification**: File is valid JSON, contains exactly 4 agents.

### M13: Bundle TRACK_AGENTS.md
Create `agents/TRACK_AGENTS.md` with the scoring system content. This is the agent tracking scoring system (SP/XP/CS mechanics) that gets installed as or merged into `~/.config/opencode/AGENTS.md`.

Content includes:
- Agent Definition section (name, model, language, framework, scope)
- Skill Points (SP) system and trust tiers
- Experience Points (XP) sources and exchange mechanics
- Communication Score (CS) grades and behavioral tiers
- CS -> XP exchange (fibonacci rates)
- XP -> SP exchange thresholds
- Post-retrospective flow
- Mini-retrospective format
- Work structure (sprints, epics, bug fixes)
- Sentinel comment markers for merge detection

**Verification**: File exists, contains sentinel markers.

### M14: Write postinstall.mjs — copyPlugin()
Function: Copy `dist/` to `~/.config/opencode/plugins/agent-tracker/`
- Resolve paths with `os.homedir()` + `path.join()`
- Create target dirs recursively (`fs.mkdirSync(..., { recursive: true })`)
- Copy all files from package dist/ using `fs.cpSync()` (Node 18+) or manual recursive copy
- Always overwrite (latest version)
- Wrap in try/catch, log errors to stderr

**Verification**: typecheck n/a (.mjs), lint n/a, manual test.

### M15: Write postinstall.mjs — installSkills()
Function: Copy skills to `~/.config/opencode/skills/`
- For each skill dir in `<package>/skills/`:
  - Check if `~/.config/opencode/skills/<skill-name>/` exists
  - If exists: skip, print "[skip] skill <name> already exists"
  - If not: create dir, copy SKILL.md, print "[install] skill <name>"
- Wrap in try/catch per skill

**Verification**: Manual test — run once (installs), run again (skips).

### M16: Write postinstall.mjs — installAgents() + registerPlugin()
Function: Merge agents and plugin into opencode.json
- Read `~/.config/opencode/opencode.json` (create if not exists)
- Parse JSON (fail gracefully on malformed)
- For each agent in agents.json:
  - If `config.agent[name]` exists: skip, print "[skip]"
  - If not: add, print "[install]"
- For plugin array:
  - Remove any `file://` entries containing `opencode-agent-tracker`
  - Add plugin path if not present
- Write back with `JSON.stringify(config, null, 2)`

**Verification**: Manual test — run with empty config, existing config, missing file.

### M17: Write postinstall.mjs — installAgentsMd()
Function: Create or merge AGENTS.md
- Read `~/.config/opencode/AGENTS.md` if exists
- If exists:
  - Check for sentinel: `<!-- agent-tracker-scoring-start -->`
  - If sentinel found: scoring section already present, skip
  - If not found: append scoring section (wrapped in sentinels), print "[merge]"
- If not exists:
  - Copy TRACK_AGENTS.md content as AGENTS.md, print "[create]"
- Wrap in try/catch

**Verification**: Manual test — run with no AGENTS.md, with existing AGENTS.md, with already-merged AGENTS.md.

### M18: Wire main() orchestrator + package.json
- Wire all functions into `main()` in postinstall.mjs
- Add CI/non-interactive detection (R9.6)
- Add error handling wrapper (R9.7) — exit 0 always
- Update package.json:
  - `"files": ["dist", "skills", "agents", "scripts/postinstall.mjs"]`
  - `"scripts": { "postinstall": "node scripts/postinstall.mjs" }`
- Run existing test suite to ensure no regressions

**Verification**: `npm run typecheck` + `npm run lint` + `npm test` all pass. Manual postinstall test.

---

## Milestone Summary

| Milestone | Task | Files | Commit |
|-----------|------|-------|--------|
| M11 | Bundle skills into repo | skills/ | Small |
| M12 | Bundle agent definitions | agents/agents.json | Small |
| M13 | Bundle TRACK_AGENTS.md | agents/TRACK_AGENTS.md | Small |
| M14 | postinstall.mjs — copyPlugin() | scripts/postinstall.mjs | Medium |
| M15 | postinstall.mjs — installSkills() | scripts/postinstall.mjs | Medium |
| M16 | postinstall.mjs — installAgents() + registerPlugin() | scripts/postinstall.mjs | Medium |
| M17 | postinstall.mjs — installAgentsMd() | scripts/postinstall.mjs | Medium |
| M18 | Wire main(), package.json, verify | scripts/postinstall.mjs, package.json | Medium |

---

## Dependency Tree

```
M11 ─┐
M12 ─┼─> M14 ─> M15 ─> M16 ─> M17 ─> M18
M13 ─┘
```

M11-M13 are independent asset bundling (can be done in parallel but will be committed sequentially for commit hygiene). M14-M17 are sequential (each function builds on the script). M18 wires everything together.

---

## Context Summary (Phase 3 Complete)

Blueprint ready. 8 milestones (M11-M18) covering asset bundling and postinstall script construction. Strategy B chosen: modular .mjs with independent helper functions. Each milestone = one commit. Verification at every step.

---

## R10: Health Status Display Redesign (FIGlet + Tron HUD)

**Strategy:** B (Tron HUD Panel)
**Dependencies:** `figlet` (runtime), `@types/figlet` (dev)

### M19: Add figlet dependency + helper module

- `npm install figlet && npm install -D @types/figlet`
- Create `src/health-display.ts` with:
  - `renderAgentName(name: string): string` — FIGlet rendering with Cybermedium font, 60-col truncation fallback
  - `getTrustTier(sp: number): string` — Maps SP to tier label (PROBATION/JUNIOR/ESTABLISHED/SENIOR/EXPERT)
  - `renderProgressBar(current: number, max: number, width: number): string` — ASCII progress bar
  - `formatHealthStatus(health: AgentHealthStatus): string` — Full Tron HUD layout
- Export `formatHealthStatus` from new module
- Unit tests for all helper functions in `tests/unit/health-display.test.ts`

**Verification:** `npm run typecheck` + `npm run lint` + `npm test`

### M20: Wire new formatHealthStatus into plugin entry

- Update `src/index.ts`:
  - Remove old `formatHealthStatus()` function
  - Import `formatHealthStatus` from `./health-display.js`
- Ensure all existing call sites (`guardAgentHealth`, `showHealthStatus`) use new import
- All existing tests must pass without changes

**Verification:** `npm run typecheck` + `npm run lint` + `npm test`

---

### Module Interface Contract

```typescript
// src/health-display.ts

import type { AgentHealthStatus } from './types.js'

/**
 * Renders agent name as FIGlet ASCII art using Cybermedium font.
 * Falls back to plain text if name exceeds 60 columns when rendered.
 */
export function renderAgentName(name: string): string

/**
 * Maps SP value to trust tier label.
 */
export function getTrustTier(sp: number): string

/**
 * Renders ASCII progress bar.
 * Example: [=========-----------] 66%
 */
export function renderProgressBar(current: number, max: number, width: number): string

/**
 * Formats full Tron HUD player sheet from AgentHealthStatus.
 */
export function formatHealthStatus(health: AgentHealthStatus): string
```

### Milestone Summary

| Milestone | Task | Files | Size |
|-----------|------|-------|------|
| M19 | figlet dep + health-display module + tests | src/health-display.ts, tests/unit/health-display.test.ts, package.json | Medium |
| M20 | Wire into index.ts, remove old function | src/index.ts | Small |

### Dependency Tree

```
M19 -> M20
```

M19 creates the module with all logic and tests. M20 wires it in and removes the old code.


---

## R11: Database-Aware Brainstorm/Plan Suggestions

**Strategy chosen:** A (Full-Scan Keyword Matching)

### System Architecture

```
QueryService (new)
  ├── extractKeywords(text) -> string[]
  ├── scoreEntry(keywords, entry) -> number
  ├── searchPriorArt(query) -> PriorArtResult
  └── formatPriorArt(result) -> string

Database (extended)
  ├── getAllRetrospectives(limit?) -> RetrospectiveEntry[]
  ├── getAllActivities(limit?) -> ActivityEntry[]
  └── getAllCommits(limit?) -> CommitData[]
```

QueryService depends only on Database interface. No coupling to TrackingService.

### Interface Contracts

```typescript
// src/types.ts — new types

export interface PriorArtQuery {
  taskDescription: string
  scope: string
  agentId?: string
  maxResults?: number
}

export interface PatternMatch {
  source: 'retrospective' | 'activity' | 'commit'
  task: string
  notes: string
  grade?: Grade
  agentId: string
  scope: string
  timestamp: string
  relevanceScore: number
}

export interface PriorArtResult {
  positivePatterns: PatternMatch[]
  crossScopePatterns: PatternMatch[]
  mistakes: PatternMatch[]
}
```

```typescript
// src/database.ts — 3 new methods added to Database interface

getAllRetrospectives(limit?: number): Promise<RetrospectiveEntry[]>
getAllActivities(limit?: number): Promise<ActivityEntry[]>
getAllCommits(limit?: number): Promise<CommitData[]>
```

```typescript
// src/query-service.ts — new module

export class QueryService {
  constructor(db: Database)
  extractKeywords(text: string): string[]
  scoreEntry(keywords: string[], fields: string[]): number
  searchPriorArt(query: PriorArtQuery): Promise<PriorArtResult>
  formatPriorArt(result: PriorArtResult): string
}
```

### Milestones

#### M21: Types + Database Interface Extension
**Files:** `src/types.ts`, `src/database.ts`, `src/lmdb-database.ts`, `src/mock-database.ts`
**Tasks:**
- Add `PriorArtQuery`, `PatternMatch`, `PriorArtResult` types to types.ts
- Add `getAllRetrospectives`, `getAllActivities`, `getAllCommits` to Database interface
- Implement in LMDBDatabase (range scan without agent prefix)
- Implement in MockDatabase (iterate all stored entries)
- Tests: verify getAll methods return entries from multiple agents

**Verification:** `npm run typecheck` + `npm run lint` + `npm test`

---

#### M22: QueryService — Keyword Extraction + Scoring
**Files:** `src/query-service.ts`, `tests/unit/query-service.test.ts`
**Tasks:**
- Create QueryService class with constructor taking Database
- Implement `extractKeywords()`: lowercase, split on non-alpha, filter stop words,
  min 3 chars, deduplicate
- Implement `scoreEntry()`: count keyword matches across fields, return ratio
- Hardcoded stop word list (~50 common English words)
- Tests: keyword extraction edge cases, scoring accuracy

**Verification:** `npm run typecheck` + `npm run lint` + `npm test`

---

#### M23: QueryService — searchPriorArt + Scope Filtering
**Files:** `src/query-service.ts`, `tests/unit/query-service.test.ts`
**Tasks:**
- Implement `searchPriorArt()` method
- Load all retrospectives, activities, commits from DB
- Score each against query keywords
- Filter by minimum threshold (0.1)
- Split into: scope-local positives, cross-scope positives, mistakes
- Sort each category by relevance score descending
- Limit each category to maxResults (default 5)
- Tests: scope filtering, cross-scope fallback, mistake detection, empty DB

**Verification:** `npm run typecheck` + `npm run lint` + `npm test`

---

#### M24: QueryService — formatPriorArt + Integration
**Files:** `src/query-service.ts`, `tests/unit/query-service.test.ts`
**Tasks:**
- Implement `formatPriorArt()` method
- Output markdown sections for each non-empty category
- Each entry: task, notes, grade label, source agent/scope, relevance %
- Handle empty results gracefully ("No prior art found")
- Tests: format output structure, empty sections omitted, grade labels correct

**Verification:** `npm run typecheck` + `npm run lint` + `npm test`

---

### Dependency Tree

```
M21 -> M22 -> M23 -> M24
```

Each milestone builds on the previous. M21 provides data access, M22 provides
scoring primitives, M23 assembles the search logic, M24 adds formatting.

### Milestone Summary

| Milestone | Task | Files | Size |
|-----------|------|-------|------|
| M21 | Types + Database getAll methods | types.ts, database.ts, lmdb-database.ts, mock-database.ts, tests | Medium |
| M22 | QueryService keyword extraction + scoring | query-service.ts, tests | Small |
| M23 | searchPriorArt with scope filtering | query-service.ts, tests | Medium |
| M24 | formatPriorArt + integration | query-service.ts, tests | Small |

---

## R12: Cross-Project Learning System

**Date**: 2026-02-23
**Strategy:** Line-by-line AGENTS.md scanner, JSON-only manifest parse + detection,
`--oneline` + `scoreEntry()` git log matching, inline tool definition, auto-classify
on session.created.

### System Architecture

```
Plugin Entry (index.ts)
  │
  ├── ProjectClassifier           (project-classifier.ts) NEW
  │     classifyProject(path) -> ProjectProfile
  │     ├── parseAgentsMd(content) -> { language, framework, scope }
  │     ├── parseManifest(path) -> { language, framework, deps, manifestType }
  │     └── hashContent(content) -> string
  │
  ├── LMDBDatabase                (lmdb-database.ts)
  │     ...existing 6 sub-dbs...
  │     └── projects DB           (sub-db, 7th) NEW
  │
  ├── QueryService                (query-service.ts)
  │     ...existing methods...
  │     ├── searchCrossProject(query, currentPath, db) NEW
  │     └── searchGitLog(paths, keywords, limit) NEW
  │
  └── init-project tool           (inline in index.ts) NEW
        classify + store profile
```

### Interface Contracts

```typescript
// src/types.ts — new types

export interface ProjectProfile {
  path: string
  language: string
  framework: string
  scope: string
  dependencies: string[]
  manifestType: string
  classifiedAt: string    // ISO 8601
  agentsmdHash: string
}

export interface GitLogMatch {
  projectPath: string
  commitHash: string
  message: string
  relevanceScore: number
}
```

```typescript
// src/database.ts — 3 new methods

putProject(path: string, profile: ProjectProfile): Promise<boolean>
getProject(path: string): Promise<ProjectProfile | null>
getAllProjects(limit?: number): Promise<ProjectProfile[]>
```

```typescript
// src/project-classifier.ts — new module

export class ProjectClassifier {
  classifyProject(projectPath: string): Promise<ProjectProfile>
  parseAgentsMd(content: string): { language: string; framework: string; scope: string }
  parseManifest(projectPath: string): Promise<{
    language: string
    framework: string
    dependencies: string[]
    manifestType: string
  }>
  scoreSimilarity(a: ProjectProfile, b: ProjectProfile): number
}
```

```typescript
// src/query-service.ts — extended

searchGitLog(projectPaths: string[], keywords: string[], limit: number): GitLogMatch[]
```

### Milestones

#### M25: ProjectProfile type + projects sub-database
**Files:** `src/types.ts`, `src/database.ts`, `src/lmdb-database.ts`,
`src/mock-database.ts`, `tests/unit/lmdb-database.test.ts`
**Tasks:**
- Add `ProjectProfile` and `GitLogMatch` types to types.ts
- Add `putProject`, `getProject`, `getAllProjects` to Database interface
- Implement in LMDBDatabase: 7th sub-database `projects`, keyed by path
- Implement in MockDatabase: Map-based storage
- Tests: put/get/getAll for projects sub-db (3-5 tests)

**Verification:** `npm run typecheck` + `npm run lint` + `npm test`

---

#### M26: ProjectClassifier — AGENTS.md + manifest parsing + similarity
**Files:** `src/project-classifier.ts` (NEW), `tests/unit/project-classifier.test.ts` (NEW)
**Tasks:**
- Create ProjectClassifier class
- `parseAgentsMd(content)`: line-by-line scanner for Language, Framework, Scope
  - Handles table format (`| Field | Value |`)
  - Handles key-value format (`Field: Value`, `**Field**: Value`)
  - Returns `{ language, framework, scope }` with "unknown" defaults
- `parseManifest(projectPath)`: checks manifest files in priority order
  - `package.json`: parse JSON, extract name from `dependencies` + `devDependencies`
    keys, infer `language` = "typescript" if `typescript` in deps else "javascript",
    infer `framework` from known packages (next, express, react, etc.)
  - `composer.json`: parse JSON, extract `require` keys, language = "php",
    infer framework from known packages (laravel/framework, symfony/*, etc.)
  - Other manifests (Cargo.toml, go.mod, pyproject.toml, requirements.txt,
    pom.xml, build.gradle, Gemfile): detection-only, infer language, deps = []
  - Returns `{ language, framework, dependencies, manifestType }`
- `classifyProject(projectPath)`: combines AGENTS.md + manifest results
  - AGENTS.md fields take priority over manifest-inferred fields
  - Computes `agentsmdHash` using Node.js `crypto.createHash('sha256')`
  - Returns complete `ProjectProfile`
- `scoreSimilarity(a, b)`: weighted scoring
  - Same language: +0.4
  - Same framework: +0.3
  - Same scope: +0.2
  - Shared deps: +0.1 * (sharedCount / max(a.deps.length, b.deps.length))
  - Returns 0.0 to 1.0
- Tests (~20-25 tests):
  - parseAgentsMd: table format, key-value format, mixed, empty, no fields
  - parseManifest: package.json with typescript, without, composer.json,
    Cargo.toml detection, no manifest
  - classifyProject: full classification, AGENTS.md priority over manifest
  - scoreSimilarity: identical, same lang only, no overlap, partial deps

**Verification:** `npm run typecheck` + `npm run lint` + `npm test`

---

#### M27: Git log fallback + cross-project search
**Files:** `src/query-service.ts`, `tests/unit/query-service.test.ts`
**Tasks:**
- Add `searchGitLog(projectPaths, keywords, limit)` method to QueryService
  - Runs `execSync('git -C <path> log --oneline -n 200', { timeout: 5000 })`
  - Parses each line: `<hash> <message>`
  - Scores message against keywords using existing `scoreEntry()`
  - Filters by minRelevance (0.1), sorts by score descending
  - Returns `GitLogMatch[]` limited to `limit`
  - Catches errors per project (non-git dirs, missing dirs), skips them
- Extend `searchPriorArt()` signature with optional `projectPath` param
- When `projectPath` is provided:
  - Instantiate ProjectClassifier, classify current project
  - Get all projects from DB via `db.getAllProjects()`
  - Score similarity, filter by threshold (0.3)
  - Pull retrospectives/activities/commits for agents in similar projects
  - Tag results with source project path
  - If DB search returns 0 results across all categories:
    call `searchGitLog()` with similar project paths
- Tests (~10-15 tests):
  - searchGitLog: mock execSync, verify parsing and scoring
  - searchGitLog: error handling (non-git dir, timeout)
  - searchPriorArt with projectPath: cross-project results found
  - searchPriorArt with projectPath: fallback to git log
  - searchPriorArt without projectPath: unchanged behavior

**Verification:** `npm run typecheck` + `npm run lint` + `npm test`

---

#### M28: init-project tool + auto-classify hook
**Files:** `src/index.ts`, `tests/unit/plugin.test.ts`
**Tasks:**
- Add `init-project` tool to the tool object in index.ts:
  - description: "Register this project for cross-project learning. Classifies
    the project based on AGENTS.md and manifest files."
  - args: {} (no arguments needed)
  - execute: classify project via ProjectClassifier, store via db.putProject(),
    return summary string with language/framework/scope/deps count
- Add `autoClassifyProject(directory)` function:
  - Check `db.getProject(directory)` — if exists, compare agentsmdHash
  - If hash unchanged: skip (already classified, no changes)
  - If hash changed or not yet classified: classify and store
  - Fire-and-forget (wrapped in try/catch, never blocks session)
- Wire `autoClassifyProject(directory)` into `session.created` hook
- Tests:
  - init-project tool: classify and store (mock classifier)
  - auto-classify: skip if already classified with same hash
  - auto-classify: re-classify if hash changed
  - auto-classify: handle errors gracefully

**Verification:** `npm run typecheck` + `npm run lint` + `npm test`

---

### Dependency Tree

```
M25 -> M26 -> M27 -> M28
```

M25 provides the data layer (types + DB methods).
M26 provides classification and similarity logic.
M27 extends search with cross-project + git log.
M28 wires everything into the plugin entry point.

### Milestone Summary

| Milestone | Task | New/Modified Files | Size |
|-----------|------|--------------------|------|
| M25 | ProjectProfile type + projects sub-db | types.ts, database.ts, lmdb-database.ts, mock-database.ts, tests | Small |
| M26 | ProjectClassifier module | project-classifier.ts (NEW), tests (NEW) | Large |
| M27 | Git log fallback + cross-project search | query-service.ts, tests | Medium |
| M28 | init-project tool + auto-classify | index.ts, tests | Medium |

---

**Blueprint ready. Use `engineer-build` to begin implementation.**
