# BRAINSTORM.md v2 - Architectural Strategies (R1-R8)

**Date**: 2026-02-23
**Input**: SPECS.md (R1-R8), LMDB 3.x API research
**Supersedes**: BRAINSTORM.md v1 (R1-R7 only)

---

## Key LMDB Capabilities Discovered

Before evaluating strategies, the following LMDB 3.x features change the design space significantly:

| Feature | Impact |
|---------|--------|
| `sharedStructuresKey` | Auto-compresses repeated object shapes. All `AgentData` objects share property names stored once. Reduces DB size substantially. |
| `transaction()` | Async ACID transaction. All `put`/`remove` inside are atomic. This is how flush should work. |
| `batch()` | Simpler grouped writes when reads aren't needed inside the callback. |
| `ifNoExists()` | Insert-if-absent -- perfect for idempotent migration (R4). |
| `ifVersion()` / conditional put | Optimistic locking. Prevents race conditions between concurrent sessions. |
| `useVersions` + `getEntry()` | Version tracking per key. Enables conflict detection without external locking. |
| Sub-databases (`openDB`) | Named databases within one environment. Clean separation of agents, commits, communication, retrospectives, activities. |
| `beforecommit` event | Hook to inject writes (e.g., metadata timestamp) into every transaction automatically. |
| `db.flushed` / `db.committed` | Know exactly when data is durable vs. visible. |
| `prefetch()` | Warm memory map for batch reads. Useful for migration (R4). |
| `getRange()` prefix scan | Already used, but `getKeys()` is lighter for existence checks in migration. |
| `cache` with `validated: true` | Multi-process safe read cache. After `put`, `get` returns the new value immediately without await. |
| Implicit event-turn batching | All `put` calls in the same event turn are auto-batched into one transaction. |

---

## Strategy A: WriteBuffer + Config Object (from v1, enhanced)

The v1 recommendation, enhanced with LMDB features.

### Approach
- **R1/R2/R3**: `DatabaseConfig` interface, `os.homedir()` resolution, `mapSize` validation
- **R4 (migration)**: Standalone `migrateFromProjectDatabase()` using `ifNoExists()` for idempotent inserts
- **R6 (write batching)**: `WriteBuffer` class, `flush()` uses `db.transaction()` for atomicity
- **R7**: Grade type change
- **R8 (state management)**: New methods on `TrackingService`, all buffer to `WriteBuffer`

### Enhancement over v1
- Use `sharedStructuresKey` in `open()` to auto-compress object shapes
- Use `ifNoExists()` in migration instead of manual exists-check + put
- Use `db.flushed` after flush to confirm durability
- Use `cache: true` for immediate read-after-buffer-write consistency

### Trade-offs
| Dimension        | Rating | Notes |
|------------------|--------|-------|
| Diff size        | ~250 lines | 2 new files (`write-buffer.ts`, `migration.ts`) |
| Atomicity        | Strong | `transaction()` |
| Testability      | High | WriteBuffer testable independently |
| Storage efficiency | Good | `sharedStructuresKey` compresses shapes |
| Migration safety | High | `ifNoExists()` is idempotent by definition |
| Complexity       | Low-Medium | Straightforward, no new abstractions |

---

## Strategy B: Sub-database Architecture

Use LMDB sub-databases to separate data domains. Each data type gets its own named database within one environment.

### Approach
- **Database structure**:
  ```
  root environment ($HOME/.config/opencode/agent-tracker.lmdb)
  ├── agents      (sub-db: AgentData keyed by agentId)
  ├── commits     (sub-db: CommitData keyed by projectPath:commitHash)
  ├── communication (sub-db: CommunicationScoreEvent keyed by agentId:commitHash:timestamp)
  ├── retrospectives (sub-db: RetrospectiveEntry keyed by agentId:commitHash)
  └── activities   (sub-db: ActivityEntry keyed by agentId:timestamp)
  ```
- **Key simplification**: No more `agent:`, `commit:`, `communication:` prefixes. Each sub-db is its own namespace. Keys become shorter, scans become faster (no prefix filtering needed).
- **Cross-database atomicity**: `transaction()` on the root database applies atomically across all sub-databases. A single flush writes agents + commits + communication + retrospectives + activities in one transaction.
- **R4 (migration)**: Read from source prefixed keys, write to target sub-databases. Use `ifNoExists()` per sub-db.
- **R6 (write batching)**: `WriteBuffer` maps entries to their target sub-database. `flush()` wraps all sub-db writes in one root `transaction()`.
- **R8 (state management)**: Each new method writes to its respective sub-db through the buffer.

### Enhancement: sharedStructuresKey per sub-db
Each sub-database has its own `sharedStructuresKey`. Since all `AgentData` objects share the exact same shape, and all `CommitData` share another shape, per-sub-db structural sharing is maximally efficient.

```typescript
const root = open({ path: dbPath, mapSize, maxDbs: 10 })
const agents = root.openDB('agents', {
  sharedStructuresKey: Symbol.for('agent-structures'),
  compression: true
})
const commits = root.openDB('commits', {
  sharedStructuresKey: Symbol.for('commit-structures'),
  compression: true
})
// ...etc
```

### Trade-offs
| Dimension        | Rating | Notes |
|------------------|--------|-------|
| Diff size        | ~350 lines | `LMDBDatabase` refactored to manage sub-dbs |
| Atomicity        | Strongest | Cross-db transactions are native to LMDB |
| Testability      | High | Each sub-db can be tested independently |
| Storage efficiency | Best | Per-type structural sharing, no key prefixes |
| Migration safety | High | `ifNoExists()` per sub-db |
| Query performance | Best | No prefix filtering, direct key lookup per type |
| Complexity       | Medium | More setup in constructor, but simpler per-operation |
| Backwards compat | Breaking | `Database` interface changes (no more prefix-based methods) |

### Critical Advantage
Range queries like "get all commits for project X" become:
```typescript
// Before (prefix scan with filtering):
db.getRange({ start: 'commit:/project:', end: 'commit:/project:~' })

// After (direct sub-db range, no prefix):
commitsDB.getRange({ start: '/project:', end: '/project:~' })
```
No wasted iteration over non-matching prefixes from other data types.

---

## Strategy C: Sub-databases + Optimistic Locking + Version Tracking

Strategy B with `useVersions: true` and conditional writes. Designed for multi-session correctness.

### Approach
Everything in Strategy B, plus:

- **Version-tracked agents**: `useVersions: true` on the agents sub-db. Every `putAgent` includes a version number. On flush, use `ifVersion()` to detect if another session modified the agent between our read and our flush.
- **Conflict resolution**: If `ifVersion()` returns false (version mismatch), re-read the agent, merge the in-memory changes (add XP deltas, add commit counts), and retry the write with the new version. This is true optimistic locking.
- **Flow**:
  ```
  1. Session starts, reads agent from DB -> gets { data, version: 3 }
  2. Session buffers: XP += 5, commits += 1
  3. Another session flushes: agent version is now 4
  4. Our session flushes: ifVersion('agent:x', 3, ...) -> false (conflict!)
  5. Re-read agent (version 4), apply our deltas, retry ifVersion('agent:x', 4, ...)
  6. Success -> version is now 5
  ```
- **Delta-based buffer**: Instead of storing full `AgentData` in the buffer, store deltas:
  ```typescript
  type AgentDelta = {
    xp_delta: number       // +5 (accumulated)
    commits_delta: number  // +1
    bugs_delta: number     // +0
    cs_delta: number       // +4
  }
  ```
  Deltas are additive and merge-friendly. On flush, apply delta to current DB state.

### Trade-offs
| Dimension        | Rating | Notes |
|------------------|--------|-------|
| Diff size        | ~450 lines | Deltas, conflict resolution, retry logic |
| Atomicity        | Strongest | Cross-db transactions + optimistic locking |
| Testability      | High | But conflict resolution paths need thorough testing |
| Storage efficiency | Best | Same as Strategy B |
| Migration safety | High | Same as Strategy B |
| Multi-session safety | Best | True optimistic locking, no lost updates |
| Complexity       | High | Retry logic, delta types, merge functions |
| Backwards compat | Breaking | Same as Strategy B |

### When is this needed?
Only if multiple OpenCode sessions modify the same agent concurrently. In practice, a user typically runs one session at a time. The conflict window is small (buffer duration between reads and flush). The risk of lost updates is low but not zero.

---

## Edge Case Analysis (updated for R8)

### E1-E9: Carried from v1
All previous edge cases remain valid. See BRAINSTORM.md v1.

### E10: State export race condition (R8.4)
If `.agent/status.json` is exported during flush and the agent reads it mid-write, the file could be incomplete. Mitigation: write to a temp file, then atomic rename (`fs.renameSync`).

### E11: Agent state initialization (R8.1)
First call to `getAgentStatus` for a new agent. The agent doesn't exist in LMDB yet. Options:
- (a) Return a default `AgentStatus` with SP=1, XP=0, CS=60
- (b) Auto-create the agent in the buffer and return it
Option (b) is better -- consistent with `initializeSessionTracking` already creating agents.

### E12: Retrospective without commit (R8.2)
`recordCommitGrade` requires a commit hash. If the agent wants to record a retrospective for work that wasn't committed (e.g., research/exploration), the commit hash field needs to accept an alternative identifier. Use session ID as fallback.

### E13: Sub-database migration path (Strategy B/C)
If we adopt sub-databases, the migration (R4) must handle the old prefix-based keys AND the new sub-db structure. The migration function reads source keys like `agent:xyz` and writes to the `agents` sub-db under key `xyz`. This is a key format transformation, not just a copy.

### E14: `maxDbs` limit
LMDB defaults to 12 named databases. We need 5 (agents, commits, communication, retrospectives, activities). Well within the limit. Set `maxDbs: 10` to leave headroom.

### E15: sharedStructuresKey conflicts
If two sub-databases use the same `Symbol.for()` string, they'd share structures incorrectly. Use unique symbols per sub-db: `Symbol.for('structures:agents')`, `Symbol.for('structures:commits')`, etc.

---

## Trade-off Matrix

| Dimension | A: WriteBuffer | B: Sub-databases | C: Sub-db + Versioning |
|-----------|---------------|-------------------|----------------------|
| Diff size | ~250 | ~350 | ~450 |
| Atomicity | Strong | Strongest | Strongest |
| Storage efficiency | Good | Best | Best |
| Query performance | Good | Best | Best |
| Multi-session safety | Weak (last-write-wins) | Weak (last-write-wins) | Best (optimistic locking) |
| Testability | High | High | High (but more paths) |
| Migration complexity | Low | Medium (key transformation) | Medium |
| Complexity | Low-Medium | Medium | High |
| New concepts | WriteBuffer | Sub-dbs, WriteBuffer | Sub-dbs, WriteBuffer, deltas, retries |

---

## Risk Assessment (updated)

| Risk | Impact | Likelihood | Strategy | Mitigation |
|------|--------|------------|----------|------------|
| Buffer data loss on crash | Low | Low | All | Flush on session.deleted |
| LMDB write lock contention | Low | Low | All | Native LMDB serialization |
| Migration fails on locked DB | Low | Medium | All | Catch, log, skip |
| mapSize exhaustion | Medium | Low | All | Clear error, read-only mode |
| `:memory:` broken by path resolution | High | High | All | Guard in constructor |
| Lost updates (concurrent sessions) | Medium | Low | A, B | Accept for now; C fixes it |
| Sub-db migration key transformation | Low | Medium | B, C | Explicit prefix-to-subdb mapping |
| sharedStructuresKey collision | High | Low | B, C | Unique Symbol per sub-db |
| State file export race condition | Low | Low | All | Atomic rename on export |
| Complexity overhead of versioning | Medium | N/A | C only | Only implement if needed |

---

## Recommendation

**Strategy B: Sub-database Architecture**

### Why not A?
Strategy A works but leaves performance and storage on the table. Prefix-based key scanning iterates over all data types to find one type. With 5 data types and growing data, this becomes wasteful. Sub-databases eliminate this entirely with zero additional complexity per operation.

### Why not C?
Optimistic locking is the correct solution for multi-writer concurrency, but the practical risk is low. Users rarely run concurrent OpenCode sessions modifying the same agent. The complexity cost (deltas, retry logic, merge functions) doesn't justify the marginal safety gain for Phase 1. Strategy C can be layered on top of Strategy B later if concurrent usage becomes a real problem.

### Why B?
1. **Sub-databases are free.** LMDB supports them natively. The code per operation actually gets simpler (no prefixes, direct key access).
2. **Cross-database atomicity is native.** A single `transaction()` on the root database atomically writes to all sub-databases. The flush is inherently atomic across all data types.
3. **`sharedStructuresKey` per sub-db** maximizes compression. All `AgentData` objects share one structure, all `CommitData` share another. The current flat keyspace forces all types to share one structure table (or none).
4. **`ifNoExists()` for migration** is cleaner than manual exists-check-then-put. It's atomic and idempotent by definition.
5. **`db.flushed` for durability** -- after flush, we know data is on disk. No guessing.
6. **Query model scales.** "Get all commits for project X" is a direct range scan on the commits sub-db, not a prefix filter across the entire database.
7. **R8 fits naturally.** Retrospectives and activities are just two more sub-databases. No key prefix pollution.

### What B changes structurally
- `LMDBDatabase` constructor opens root + 5 named sub-dbs
- `putAgent` / `getAgent` operate on `agents` sub-db directly
- `putCommit` / `getCommit` operate on `commits` sub-db directly
- New methods (`putRetrospective`, `putActivity`) operate on their respective sub-dbs
- `WriteBuffer.flush()` wraps all sub-db writes in one root `transaction()`
- Migration reads old prefix keys, writes to sub-dbs
- `Database` interface extends with new methods (non-breaking: new methods only)

### New file structure
```
src/
├── index.ts              # Plugin entry point (wires config, hooks)
├── lmdb-database.ts      # LMDB with sub-databases, DatabaseConfig
├── write-buffer.ts       # NEW: Write buffer with typed entries
├── migration.ts          # NEW: Per-project DB migration
├── tracking-service.ts   # State management, uses WriteBuffer
├── dependency-checker.ts # Unchanged
├── env-protection.ts     # Unchanged
├── database.ts           # Extended interface
├── mock-database.ts      # Updated to match interface
└── types.ts              # Grade, RetrospectiveEntry, ActivityEntry, DatabaseConfig
```

---

**Architectural paths explored. Use `architect-plan` to map the build.**
