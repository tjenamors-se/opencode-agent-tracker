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
