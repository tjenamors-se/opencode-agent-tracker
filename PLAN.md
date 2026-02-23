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
