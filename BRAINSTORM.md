# BRAINSTORM.md - Architectural Strategies

**Date**: 2026-02-23
**Input**: SPECS.md (R1-R7)
**Goal**: Explore implementation strategies, trade-offs, and risks

---

## Strategy A: Minimal Patch (Surgical fixes, smallest diff)

Modify only what is strictly necessary. Keep the existing class structure intact.

### Approach
- **R1/R3 (path)**: Add `os.homedir()` + `path.join()` resolution directly in `LMDBDatabase` constructor. Accept optional config object.
- **R2 (size)**: Add `mapSize` parameter to `open()` call in `initialize()`.
- **R4 (migration)**: Add a static `migrate()` method on `LMDBDatabase` that opens a source DB, reads all keys via `getRange()`, checks existence in target, and writes diffs.
- **R6 (write batching)**: Add a `WriteBuffer` as a private `Map<string, unknown>` inside `TrackingService`. Each write method pushes to the map instead of calling `put*`. Add `flushWriteBuffer()` that iterates the map and calls existing `put*` methods sequentially.
- **R7 (grade)**: Change the type union. One line.

### Trade-offs
| Dimension        | Rating   | Notes |
|------------------|----------|-------|
| Diff size        | Smallest | ~80 lines changed |
| Risk             | Low      | No structural changes |
| Testability      | Medium   | Buffer lives inside TrackingService, harder to test in isolation |
| Atomicity        | Weak     | Sequential `put*` calls, not a true LMDB transaction |
| Reusability      | Low      | Buffer logic is coupled to TrackingService |
| Migration safety | Medium   | Static method, but no separation of concerns |

---

## Strategy B: Buffer Layer + Database Config Object (Moderate refactor)

Introduce a `DatabaseConfig` interface and a `WriteBuffer` class as first-class components. Restructure `LMDBDatabase` constructor to accept a config object. Migration becomes a standalone function.

### Approach
- **R1/R2/R3 (config)**: Create a `DatabaseConfig` interface:
  ```typescript
  interface DatabaseConfig {
    path?: string           // default: os.homedir() + ...
    maxSize?: number        // default: 512 * 1024 * 1024
    compression?: boolean   // default: true
  }
  ```
  `LMDBDatabase` constructor takes `DatabaseConfig` instead of a raw string. Path resolution and validation happen in a private `resolvePath()` method. Size validation in a private `validateMapSize()`.

- **R4 (migration)**: Standalone `migrateFromProjectDatabase(source: string, target: LMDBDatabase): Promise<MigrationResult>` function in a new file `src/migration.ts`. Returns `{ entriesMigrated: number, entriesSkipped: number, errors: string[] }`. Called from `index.ts` after DB init.

- **R6 (write batching)**: New class `WriteBuffer` in `src/write-buffer.ts`:
  ```typescript
  class WriteBuffer {
    private pending: Map<string, { type: 'agent' | 'commit' | 'communication', data: unknown }>
    bufferAgent(key: string, data: AgentData): void
    bufferCommit(key: string, data: CommitData): void
    bufferCommunicationEvent(key: string, data: CommunicationScoreEvent): void
    async flush(db: LMDBDatabase): Promise<void>  // single LMDB transaction
    clear(): void
    get size(): number
  }
  ```
  `TrackingService` receives `WriteBuffer` in constructor. All write methods call buffer. `flush()` uses LMDB's `transaction()` API for atomicity.

- **R7 (grade)**: Type change + validation constant `VALID_GRADES = [-1, 1, 2, 5] as const`.

### Trade-offs
| Dimension        | Rating   | Notes |
|------------------|----------|-------|
| Diff size        | Medium   | ~200 lines, 2 new files |
| Risk             | Low-Med  | New classes but clear boundaries |
| Testability      | High     | WriteBuffer testable independently, migration testable independently |
| Atomicity        | Strong   | True LMDB transaction via `transaction()` |
| Reusability      | High     | WriteBuffer and migration are standalone |
| Migration safety | High     | Separate module with structured result reporting |

---

## Strategy C: Full Database Abstraction (Large refactor)

Refactor the entire database layer. Make `LMDBDatabase` implement the `Database` interface explicitly. Introduce a `BufferedDatabase` decorator that wraps any `Database` and adds write buffering transparently. Migration via a `DatabaseMigrator` class.

### Approach
- **Database layer**: `LMDBDatabase implements Database`. `MockDatabase implements Database`. New `BufferedDatabase implements Database` that wraps another `Database` and buffers writes.
- **BufferedDatabase**: Intercepts all `put*` calls, stores in memory, passes all `get*` calls through to the underlying database. Exposes `flush()`. The `TrackingService` never knows about buffering -- it just uses `Database`.
- **Config**: `DatabaseFactory.create(config: DatabaseConfig): Database` factory that handles path resolution, size validation, and optionally wraps in `BufferedDatabase`.
- **Migration**: `DatabaseMigrator` class that takes source and target `Database` instances.

### Trade-offs
| Dimension        | Rating   | Notes |
|------------------|----------|-------|
| Diff size        | Large    | ~400+ lines, 3-4 new files, refactor existing |
| Risk             | Medium   | Decorator pattern adds indirection; `get*` after buffered `put*` must read from buffer first (read-your-writes) |
| Testability      | Highest  | Every layer independently testable |
| Atomicity        | Strong   | Transaction in BufferedDatabase.flush() |
| Reusability      | Highest  | Database abstraction works for any backend |
| Migration safety | High     | Generic migrator works between any Database pairs |

### Critical Edge Case
`BufferedDatabase` must handle **read-your-writes**: if `putAgent` is buffered but `getAgent` is called before flush, it must return the buffered value, not the stale DB value. This adds complexity to every `get*` method.

---

## Edge Case Analysis

### E1: Concurrent plugin instances
Two OpenCode sessions on different projects sharing the same central DB. LMDB handles this natively (MVCC, single-writer lock). No code changes needed -- LMDB's write lock serializes flushes. But: if one session holds the write lock during a long flush, the other session's flush will block. With 512 MB max and buffered writes, flush size is small -- acceptable.

### E2: Buffer data loss on crash
If the process crashes between buffering and flushing, buffered data is lost. This is acceptable for XP/commit tracking (non-critical data). Mitigation: `session.deleted` flush as safety net. Additional mitigation possible via periodic flush (e.g., every 5 minutes), but adds complexity -- not recommended for Phase 1.

### E3: Migration source DB locked by old process
If a stale OpenCode process holds a lock on the per-project DB, migration will fail to open it. Mitigation: catch the error, log a warning, skip migration. The user can retry after killing the stale process.

### E4: Database path permissions
`os.homedir()` may point to a directory where the user lacks write permission (e.g., restricted environments). Mitigation: graceful degradation already exists -- `initialize()` catches errors and sets `available = false`.

### E5: mapSize exhaustion at 512 MB
When the DB approaches 512 MB, writes will fail with `MDB_MAP_FULL`. Mitigation: catch this error specifically during flush, log a clear message ("Database full, consider increasing maxDatabaseSize"), and continue in read-only mode. Do NOT auto-resize -- the limit is intentional.

### E6: Grade type backwards compatibility
Changing the grade union from `-1 | 1 | 2` to `-1 | 1 | 2 | 5` is additive and backwards compatible. Existing data with grades -1, 1, 2 remains valid. No migration needed.

### E7: `:memory:` path in tests
Tests use `LMDBDatabase(':memory:')`. Path resolution must NOT apply `os.homedir()` logic to `:memory:` -- it must be passed through as-is. Add a guard: if path is `:memory:`, skip resolution.

### E8: Relative custom path
User provides `databasePath: './my-db'` in config. Per spec, resolve against `os.homedir()`: `path.resolve(os.homedir(), './my-db')`. This prevents project-relative paths.

### E9: Write buffer key collisions
Multiple `incrementXP` calls for the same agent within one session. The buffer stores by key, so the latest state wins. This is correct -- intermediate states don't matter, only the final XP value does. But: the buffer must merge intelligently. If `incrementXP(agentId, 1)` is called 5 times, the buffer needs to either:
- (a) Read the current agent state once, apply all increments in memory, store final state, OR
- (b) Store a delta/increment list and apply them all at flush time

Option (a) is simpler and aligns with "reads are free". Read once at first buffer write, mutate in memory, flush final state.

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Buffer data loss on crash | Low (XP/tracking data is non-critical) | Low (sessions usually end normally) | Flush on session.deleted |
| LMDB write lock contention | Low (flush is fast, small batch) | Low (concurrent usage is rare) | LMDB handles natively |
| Migration fails on locked DB | Low (one-time operation) | Medium (stale processes exist) | Catch, log, skip |
| mapSize exhaustion | Medium (writes stop) | Low (512 MB is generous for tracking) | Clear error message, read-only mode |
| `:memory:` path broken by resolution | High (all tests break) | High (if not guarded) | Guard `:memory:` in path resolution |
| Read-your-writes inconsistency | Medium (stale reads during session) | Strategy C only | Avoid Strategy C |

---

## Recommendation

**Strategy B** is the best fit.

Rationale:
- Strategy A's sequential `put*` calls lack atomicity and the buffer is untestable in isolation
- Strategy C's `BufferedDatabase` decorator introduces read-your-writes complexity that adds risk for no practical benefit (the TrackingService already knows it's buffering)
- Strategy B gives us:
  - Standalone `WriteBuffer` class (testable, clear API)
  - True LMDB transaction atomicity on flush
  - Separate migration module with structured result reporting
  - `DatabaseConfig` interface that replaces the raw string constructor
  - Minimal structural change to existing code (~200 lines)
  - No read-your-writes problem because `TrackingService` explicitly reads from DB and writes to buffer -- the separation is intentional and visible

The `TrackingService` pattern becomes: **read current state from DB -> mutate in memory -> buffer the result -> flush on push/session end**. This is simple, explicit, and testable.

---

**Architectural paths explored in BRAINSTORM.md. Use `architect-plan` to map the build.**
