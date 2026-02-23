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

---

# BRAINSTORM: NPM Postinstall Setup (R9)

**Date**: 2026-02-23
**Input**: SPECS.md R9 (R9.1-R9.7)

---

## Problem Analysis

The postinstall script must perform 5 independent filesystem operations after npm install:
1. Copy plugin dist/ to ~/.config/opencode/plugins/agent-tracker/
2. Copy 2 skill directories to ~/.config/opencode/skills/
3. Merge 4 agent definitions into opencode.json
4. Register plugin path in opencode.json plugin array
5. Create or merge AGENTS.md scoring system

Key constraints: exit 0 always, skip-if-exists, no dependencies (Node.js built-ins only), ESM (.mjs).

---

## Strategy A: Single Sequential Script

### Approach
One `scripts/postinstall.mjs` file that runs all 5 operations sequentially. Each operation wrapped in try/catch. Uses only `fs`, `path`, `os`.

### Structure
```
scripts/postinstall.mjs      (~200 lines)
skills/                       (bundled skill files)
agents/agents.json            (bundled agent definitions)
agents/TRACK_AGENTS.md        (bundled scoring system)
```

### Trade-offs
| Dimension        | Rating | Notes |
|------------------|--------|-------|
| Complexity       | Low    | One file, linear flow |
| Maintainability  | Medium | 200+ lines in one file |
| Testability      | Low    | Hard to unit test (fs operations) |
| Error isolation  | Good   | Each op independent, try/catch |
| Dependencies     | None   | Node.js built-ins only |

---

## Strategy B: Modular Script with Helper Functions

### Approach
One `scripts/postinstall.mjs` entry point, but operations split into clearly separated async functions. Each function handles one R9 sub-requirement.

### Structure
```
scripts/postinstall.mjs       (~250 lines, well-structured)
skills/
  agile-spec-to-build/SKILL.md
  structured-review/SKILL.md
agents/
  agents.json
  TRACK_AGENTS.md
```

### Functions
```javascript
async function copyPlugin(configDir)         // R9.1
async function installSkills(configDir)      // R9.2
async function installAgents(configDir)      // R9.3
async function registerPlugin(configDir)     // R9.4
async function installAgentsMd(configDir)    // R9.5
function isNonInteractive()                  // R9.6
async function main()                        // orchestrator
```

### Trade-offs
| Dimension        | Rating | Notes |
|------------------|--------|-------|
| Complexity       | Low    | Clear separation of concerns |
| Maintainability  | High   | Each function is self-contained |
| Testability      | Medium | Functions could be imported and tested |
| Error isolation  | Best   | Each function has own try/catch |
| Dependencies     | None   | Node.js built-ins only |

---

## Strategy C: TypeScript Script (compiled)

### Approach
Write the postinstall in TypeScript (`src/postinstall.ts`), compile it along with the main plugin. This gives type safety and access to shared types.

### Trade-offs
| Dimension        | Rating | Notes |
|------------------|--------|-------|
| Complexity       | Medium | Need to ensure tsc outputs to right location |
| Maintainability  | High   | Type safety, shared types |
| Testability      | High   | Can unit test with Jest |
| Error isolation  | Good   | Same as B |
| Dependencies     | None   | Still Node.js built-ins at runtime |
| Build coupling   | Risk   | postinstall must work even if build partially fails |

### Risk
The postinstall script runs AFTER npm install but the script itself needs to be pre-built. If tsc fails, the postinstall won't exist. Since `"prepack": "npm run build"` runs before publishing, this should work for published packages. But for local development (`npm link`), the script might not be built yet.

---

## Edge Case Analysis

### E1: opencode.json doesn't exist yet
New user who just installed OpenCode but hasn't configured anything. The file may not exist at all. Must create with minimal valid structure:
```json
{
  "plugin": ["~/.config/opencode/plugins/agent-tracker"]
}
```

### E2: opencode.json has no agent or plugin key
File exists but is minimal (e.g., only has model config). Must add agent and plugin keys without destroying existing content.

### E3: opencode.json is malformed JSON
User may have hand-edited the file with a syntax error. Options:
- (a) Fail gracefully with a clear error message
- (b) Try to fix common issues (trailing commas)
Option (a) is safer -- don't risk corrupting the file further.

### E4: Skills directory has extra files
User might have custom files alongside SKILL.md. Since we skip-if-directory-exists, this is a non-issue.

### E5: Plugin dist/ directory has different structure than expected
The postinstall copies from the npm package's dist/, which is always the right version. No conflict possible.

### E6: Permissions error on ~/.config/opencode/
macOS/Linux permission issues. Must catch and report clearly.

### E7: AGENTS.md merge detection
How to detect which scoring sections already exist? Options:
- (a) Look for specific heading markers (e.g., "## Agent Scoring System")
- (b) Look for key phrases (e.g., "Skill Points (SP)")
- (c) Check for a sentinel comment (e.g., "<!-- agent-tracker-scoring -->")
Option (c) is most reliable -- headings/phrases could be coincidental. Use a sentinel comment.

### E8: Plugin path format in opencode.json
The current config uses `file:///path/to/dist` format. Should the postinstall use:
- (a) Absolute path: `~/.config/opencode/plugins/agent-tracker`
- (b) Relative path: `./plugins/agent-tracker`
- (c) Plugin name only: `agent-tracker`
Need to check what OpenCode supports. The current entries use file:// protocol, so (a) with file:// prefix is safest: `file:///home/user/.config/opencode/plugins/agent-tracker`

### E9: npm global vs local install
If installed globally (`npm i -g`), the postinstall still runs. The script should work regardless of where npm installs the package, since all paths are based on os.homedir().

---

## Recommendation

**Strategy B: Modular Script with Helper Functions**

### Why not A?
Same work, worse organization. A monolithic script is harder to debug when one operation fails.

### Why not C?
TypeScript adds build coupling risk. The postinstall script is a simple filesystem operation -- it doesn't need type safety from the main project. It should be as independent as possible. If the TypeScript build breaks, the postinstall must still work. ESM JavaScript is simpler and eliminates this risk entirely.

### Why B?
1. **Independence**: The .mjs script has zero coupling to the TypeScript build pipeline
2. **Debuggability**: Each function logs its own success/skip/error messages
3. **Resilience**: Each operation is independent -- failure of one doesn't affect others
4. **Simplicity**: ~250 lines of clean JavaScript, no build step needed
5. **No dependencies**: Only uses fs, path, os from Node.js stdlib

### Bundled assets to create
1. Copy skills from ~/.config/opencode/skills/ into the repo at skills/
2. Extract agent definitions from opencode.json into agents/agents.json
3. Create agents/TRACK_AGENTS.md with the scoring system content
4. Write scripts/postinstall.mjs
5. Update package.json files array and postinstall script

---

**Architectural paths explored in BRAINSTORM.md. Use `architect-plan` to map the build.**

---

## R10: Health Status Display Redesign — Brainstorm

### Strategy A: Minimal Tron Grid

Simple, clean layout with FIGlet header + labeled stat rows using pure spacing.

```
____ ____ ____ _  _ ___
|__| | __ |___ |\ |  |
|  | |__] |___ | \|  |

  CLASS    JUNIOR          SP  2.7
  XP      17.7 / 27.0
  [=========-----------]   66%
  CS      0.0
  COMMITS 36.0    BUGS 3.0
  HALTED  no
```

**Pros:** Dead simple. No borders = no alignment bugs. Easy to maintain. Fits 60 cols easily.
**Cons:** May look too plain. Less "Tron" feel.

### Strategy B: Tron HUD Panel

Structured sections with ASCII separators (dashes, equals) and alignment.

```
____ ____ ____ _  _ ___
|__| | __ |___ |\ |  |
|  | |__] |___ | \|  |

  ============== IDENTITY ==============
  CLASS : JUNIOR            TIER : 2-3
  =============== STATS ================
  SP    : 2.7       CS    : 0.0
  XP    : 17.7 / 27.0
  [==========----------]  66%
  =============== RECORD ===============
  COMMITS : 36.0    BUGS  : 3.0
  HALTED  : no
  ======================================
```

**Pros:** Strong visual structure. Tron HUD aesthetic. Clear section grouping.
**Cons:** More complex to implement. Section separators add lines.

### Strategy C: Compact Data Block

Maximum information density. Two-column layout where possible.

```
____ ____ ____ _  _ ___
|__| | __ |___ |\ |  |
|  | |__] |___ | \|  |

  JUNIOR | SP 2.7 | CS 0.0 | XP 17.7/27.0
  [==========----------] 66%
  COMMITS 36.0 | BUGS 3.0 | HALTED no
  PENDING none
```

**Pros:** Very compact — 4 lines of stats. Quick scan.
**Cons:** Dense. Less RPG feel. Pipe separators may feel like tables not Tron.

### Trade-off Matrix

| Aspect          | Strategy A      | Strategy B       | Strategy C      |
|-----------------|-----------------|------------------|-----------------|
| Complexity      | Low             | Medium           | Low             |
| Tron aesthetic  | Weak            | Strong           | Medium          |
| Readability     | Good            | Excellent        | Good (dense)    |
| Width control   | Easy            | Medium           | Easy            |
| Maintainability | Simple          | Moderate         | Simple          |
| RPG feel        | Minimal         | Strong           | Weak            |
| Lines of output | ~8              | ~12              | ~6              |

### Edge Cases

1. **Long agent names**: "AgentTracker-Core" = 58 cols. Names >12 chars may exceed 60 cols. Need truncation or `Cybersmall` fallback.
2. **XP/SP at zero**: Progress bar shows 0%. Display `[--------------------] 0%`.
3. **CS at cap**: When CS is at `SP * 100`, could show "(MAX)" label.
4. **Many pending changes**: List could exceed toast height. Limit to first 5 with "+ N more".
5. **Halted agent**: When halted, could add a warning line/banner.

### Risk Assessment

- **FIGlet bundle size**: `figlet` package includes font files (~300KB). Could impact install size. Acceptable for dev tooling.
- **FIGlet sync API**: `textSync()` is synchronous — safe for our sync `formatHealthStatus()`.
- **Font availability**: Cybermedium is bundled with figlet. No external font loading needed.
- **Testing**: Need to mock `figlet.textSync()` in tests to avoid font file dependency.

### Recommendation

**Strategy B (Tron HUD Panel)** — it has the strongest Tron aesthetic and RPG player sheet feel. The section separators (`===`) create visual structure without Unicode box-drawing. It's more lines but within toast limits and provides the best user experience.


---

## R11: Database-Aware Brainstorm/Plan Suggestions

### Strategy A: Full-Scan Keyword Matching

Load all retrospectives, activities, and commits from the database, then score
each entry against the query's keyword set.

**Approach:**
1. Extract keywords from query task description (lowercase, remove stop words,
   min 3 chars)
2. Call `getAllRetrospectives()`, `getAllActivities()`, `getAllCommits()` to load
   all historical data
3. For each entry, count keyword matches across text fields
4. Score = matched_keywords / total_keywords
5. Filter by minimum threshold (0.1), sort by score descending
6. Split results into scope-local vs cross-scope vs mistakes

**Pros:**
- Simple to implement — no index building or maintenance
- Works immediately with existing data
- Keyword extraction is straightforward (split + filter)
- No new dependencies

**Cons:**
- O(n) scan of all entries on every query
- Performance degrades with large datasets (thousands of entries)
- No semantic understanding — "refactor" won't match "restructure"

**Performance estimate:** LMDB reads are memory-mapped, so scanning 1000 entries
should complete in < 50ms. Acceptable for interactive brainstorm phases.

---

### Strategy B: Tag-Based Index with Separate Sub-Database

Create a new `patterns` sub-database that stores pre-indexed entries with tags
extracted at write time.

**Approach:**
1. New sub-database `patterns` with key format `tag:keyword`
2. When a retrospective or activity is written, extract keywords and write
   index entries pointing to the source record
3. At query time, look up each query keyword in the patterns DB
4. Intersect/union results based on match count

**Pros:**
- O(k) lookup where k = number of query keywords (fast)
- Scales to very large datasets
- Could support future semantic tags (manually assigned)

**Cons:**
- Requires maintaining a secondary index
- Index must be rebuilt if keyword extraction logic changes
- More complex write path (extract + index on every commit/retro)
- 7th sub-database adds complexity to database.ts interface
- Existing historical data needs backfill migration

**Risk:** Over-engineering for current dataset sizes. The plugin tracks a single
developer's agents — unlikely to exceed thousands of entries.

---

### Strategy C: Hybrid — Full Scan with Cached Results

Full-scan approach (Strategy A) but cache results in memory during a session.

**Approach:**
1. Same keyword matching as Strategy A
2. On first query in a session, load and score all entries
3. Cache the scored results in QueryService instance
4. Subsequent queries in the same session reuse cached data
5. Cache invalidated when new data is written

**Pros:**
- Fast for repeated queries in the same brainstorm session
- Simple implementation, no new sub-database
- Memory overhead is bounded (single session lifetime)

**Cons:**
- First query still does full scan
- Cache invalidation adds complexity
- Marginal benefit — brainstorm typically has 1-2 queries per session

---

### Trade-off Matrix

| Aspect              | Strategy A     | Strategy B       | Strategy C      |
|---------------------|----------------|------------------|-----------------|
| Implementation      | Simple         | Complex          | Medium          |
| Query performance   | O(n)           | O(k)             | O(n) first, O(1)|
| Write overhead      | None           | Index writes     | None            |
| New sub-databases   | 0              | 1                | 0               |
| Interface changes   | 3 new methods  | 3+ new methods   | 3 new methods   |
| Scalability         | Good to ~10K   | Excellent        | Good to ~10K    |
| Maintainability     | Easy           | Hard             | Medium          |
| Risk                | Low            | High             | Low             |

### Edge Cases

1. **No historical data**: Return empty results with a note "No prior art found"
2. **Very short task description** (1-2 words): May match too broadly. Require
   minimum 2 keywords for meaningful search.
3. **All entries from same scope**: Cross-scope section will be empty. That's fine.
4. **Entries with empty notes**: Skip entries where all text fields are empty.
5. **Large number of "bad" grades**: Limit mistakes to maxResults to avoid
   overwhelming the agent.

### Risk Assessment

- **LMDB read performance**: Memory-mapped reads are essentially memcpy.
  Scanning 10K entries is microseconds. Not a real risk.
- **Keyword matching quality**: Simple keyword matching won't understand
  synonyms. This is acceptable for v1 — the plugin tracks one developer's
  work, so terminology should be consistent.
- **Database interface changes**: Adding 3 `getAll*` methods is a clean extension.
  Both LMDBDatabase and MockDatabase need implementations. Low risk.
- **Stop word list**: Need a reasonable English stop word list (the, a, is, etc).
  Keep it small (~50 words) and hardcoded.

### Recommendation

**Strategy A (Full-Scan Keyword Matching)** — It is the simplest approach that
meets all requirements. The dataset will realistically stay under 10K entries
(single developer, ~40 commits so far). Full-scan with LMDB memory-mapped reads
will complete in microseconds. No premature optimization needed.

If query latency becomes an issue in the future (unlikely), Strategy B can be
added as an optimization without changing the QueryService API.

---

## R12: Cross-Project Learning System — Brainstorm

**Date**: 2026-02-23
**Input**: SPECS.md R12 (R12.1-R12.7)

---

### Decision 1: How to Parse AGENTS.md

The AGENTS.md file contains agent definition fields (Name, Model, Language,
Framework, Scope) but in varying formats: Markdown tables, YAML frontmatter,
free-form text, or a mix.

#### Option A: Regex-Based Table/Field Extraction

Parse AGENTS.md using regex patterns that look for:
- Markdown table rows: `| Language | TypeScript |`
- Key-value pairs: `Language: TypeScript` or `**Language**: TypeScript`
- Heading-based sections: `## Language\nTypeScript`

```typescript
const FIELD_PATTERNS = {
  language: /(?:language|lang)\s*[:|]\s*(\w+)/i,
  framework: /(?:framework|fw)\s*[:|]\s*([\w.-]+)/i,
  scope: /(?:scope|domain)\s*[:|]\s*(\w+)/i,
}
```

**Pros:**
- Simple to implement (~40 lines)
- Handles most common AGENTS.md formats
- No external parser dependency
- Best-effort by design — returns "unknown" if no match

**Cons:**
- Won't catch creative formatting
- Regex can be brittle with unexpected whitespace
- Doesn't understand Markdown structure (just text matching)

#### Option B: Markdown AST Parsing

Use a Markdown parser (e.g., `marked`, `remark`) to build an AST, then walk
the tree looking for tables with field names and heading sections.

**Pros:**
- Structurally correct parsing
- Handles nested formatting, links in values, etc.
- More robust against formatting variations

**Cons:**
- New dependency (we want to stay at lmdb-only for runtime deps)
- Over-engineered for best-effort classification
- AST walking is more code than regex
- Still falls back to "unknown" if fields aren't present

#### Option C: Line-by-Line Field Scanner

Read AGENTS.md line by line. For each line, check if it contains a known
field name followed by a separator (|, :, =) and a value. Track context
via simple state (current heading).

```typescript
for (const line of content.split('\n')) {
  const trimmed = line.trim()
  // Check table format: | Field | Value |
  const tableMatch = trimmed.match(/^\|?\s*(Language|Framework|Scope)\s*\|\s*(.+?)\s*\|?$/i)
  if (tableMatch) { fields[tableMatch[1].toLowerCase()] = tableMatch[2].trim() }
  // Check key: value format
  const kvMatch = trimmed.match(/^\*?\*?(Language|Framework|Scope)\*?\*?\s*[:=]\s*(.+)$/i)
  if (kvMatch) { fields[kvMatch[1].toLowerCase()] = kvMatch[2].trim() }
}
```

**Pros:**
- No dependency needed
- Handles both table and key-value formats
- Clear, readable code
- Easy to extend with new field patterns
- Line-by-line is more predictable than multi-line regex

**Cons:**
- Slightly more code than Option A
- Doesn't handle multi-line values (not needed for our fields)

**Recommendation: Option C (Line-by-Line Field Scanner)**

Most robust without adding dependencies. The fields we extract (language,
framework, scope) are always single-line values. Line-by-line scanning is
deterministic and easy to test. Falls back to "unknown" for anything it
can't parse — exactly what the spec requires.

---

### Decision 2: Manifest File Support in v1

The spec lists 7 manifest formats. How many should v1 support?

#### Option A: Full Support (All 7)

Implement parsers for package.json, composer.json, Cargo.toml, pyproject.toml,
requirements.txt, go.mod, pom.xml, build.gradle, Gemfile.

**Pros:** Complete from day one.
**Cons:** 7+ parsers is a lot of code. TOML, XML, and Gradle need custom parsers
(no runtime deps). Testing surface is large. Many of these formats may never be
encountered by this user.

#### Option B: Top 3 (package.json, composer.json, Cargo.toml)

Focus on the most common formats. JSON is trivially parsed. Cargo.toml has a
simple `[dependencies]` section parseable with regex. composer.json is JSON.

**Pros:**
- Covers TypeScript/JavaScript, PHP, Rust — the user's primary languages
- JSON parsing is free (built-in). TOML dependency section is simple regex.
- Manageable test surface (~30 lines per parser)
- Others can be added later without changing the interface

**Cons:**
- Python/Go/Java/Ruby projects won't be classified from manifests
- Still classifiable from AGENTS.md though

#### Option C: JSON-Only (package.json, composer.json) + Detection-Only for Others

Parse JSON manifests fully. For non-JSON manifests, only detect their
existence (to infer language) without extracting dependencies.

```typescript
// Full parse: extract deps
if (exists('package.json')) → parse JSON, extract dependencies
if (exists('composer.json')) → parse JSON, extract require

// Detection only: infer language
if (exists('Cargo.toml')) → language = 'rust', deps = []
if (exists('go.mod')) → language = 'go', deps = []
if (exists('pyproject.toml') || exists('requirements.txt')) → language = 'python', deps = []
```

**Pros:**
- Zero custom parsers for non-JSON formats
- All 7 languages detectable
- Dependency extraction where it matters most (npm/composer ecosystems)
- Simplest implementation
- Still enables similarity scoring via language/framework matching

**Cons:**
- No dependency data for Rust/Go/Python/Java/Ruby projects
- Dependency overlap scoring only works for Node.js and PHP projects

**Recommendation: Option C (JSON-Only Parse + Detection for Others)**

Best balance. The user's projects are primarily TypeScript and possibly PHP.
Full dependency extraction for those two ecosystems covers the primary use
case. For other languages, just knowing the language is enough for similarity
scoring (language has the highest weight at 0.4). Dependencies only contribute
0.1 to the similarity score — not worth complex TOML/XML parsers.

---

### Decision 3: Git Log Search Strategy

When LMDB search returns zero results, fall back to searching git log of
similar projects.

#### Option A: `git log --oneline` + Keyword Match

```bash
git -C /path/to/project log --oneline -n 200
```
Returns `<hash> <message>` per line. Match keywords against commit messages.

**Pros:** Simple, fast, universal. One-line output is easy to parse.
**Cons:** Only gets the first line of commit messages. No diff context.

#### Option B: `git log --format` with Custom Format

```bash
git -C /path/to/project log --format="%H|%s|%b" -n 200
```
Returns hash, subject, and body separated by `|`.

**Pros:** Gets full commit body for better keyword matching.
**Cons:** Multi-line body complicates parsing. Pipe character might appear in
messages. Needs `%x00` (null byte) as separator for reliable parsing.

#### Option C: `git log --oneline --grep` for Server-Side Filtering

```bash
git -C /path/to/project log --oneline --grep="keyword1\|keyword2" -n 50
```
Let git do the filtering. Only matching commits are returned.

**Pros:** Fastest — git filters before output. Minimal data transfer.
**Cons:** Git grep syntax is limited. Multiple keywords need `\|` (OR).
Can't do relevance scoring (just match/no-match). Can't combine with AND
logic easily.

#### Option D: Hybrid — `--oneline` with Post-Filter Scoring

Use `--oneline` for raw data (Option A), then apply the same `scoreEntry()`
keyword matching from QueryService. This reuses existing code.

```typescript
const output = execSync(`git -C ${path} log --oneline -n 200`, { timeout: 5000 })
const lines = output.toString().split('\n')
for (const line of lines) {
  const [hash, ...messageParts] = line.split(' ')
  const message = messageParts.join(' ')
  const score = this.scoreEntry(keywords, [message])
  if (score >= minRelevance) matches.push({ hash, message, score })
}
```

**Pros:**
- Reuses existing `scoreEntry()` and keyword infrastructure
- Relevance scoring for ranking (not just match/no-match)
- Simple, reliable parsing
- Consistent behavior with LMDB search (same scoring algorithm)

**Cons:**
- Loads 200 lines into memory per project (trivial)
- Subject-line only (no body), but usually sufficient for commit messages

**Recommendation: Option D (Hybrid — oneline + scoreEntry)**

Reusing `scoreEntry()` gives consistent behavior between LMDB and git log
search paths. The `--oneline` format is universally reliable. Subject-line
matching is sufficient — commit bodies are rarely searched in practice.
The 200-commit limit and 5s timeout keep it bounded.

---

### Decision 4: Store Git Log Results or Query Live?

#### Option A: Always Query Live

Run `git log` on every fallback search. Don't cache results.

**Pros:** Always fresh. No stale data. No extra storage.
**Cons:** Slower if multiple searches hit fallback in one session.

#### Option B: Cache in Memory for Session Duration

Store git log results in QueryService instance memory. Invalidate on new
session.

**Pros:** Fast for repeated fallback queries in same session.
**Cons:** Extra complexity. Fallback queries are rare by design (only when
LMDB has zero results). Marginal benefit.

#### Option C: Store in LMDB

Cache git log matches in a new sub-database.

**Pros:** Persistent cache across sessions.
**Cons:** Over-engineered. Git log results become stale. Adds an 8th sub-db.
Need cache invalidation strategy.

**Recommendation: Option A (Always Query Live)**

Git log fallback is the last resort — it only fires when LMDB search finds
nothing. This is rare. Running `git log --oneline -n 200` takes <100ms
even for large repos. No caching needed.

---

### Decision 5: `/init` Tool Integration

How to register the `init-project` tool in the plugin.

#### Option A: Inline Tool Definition (Same as `migrate-agent-tracker`)

Add `init-project` to the `tool` object returned by the plugin, next to
`migrate-agent-tracker`. The execute function calls `ProjectClassifier`,
stores the profile, and returns a summary.

```typescript
tool: {
  'migrate-agent-tracker': { ... },
  'init-project': {
    description: 'Register this project for cross-project learning...',
    args: {},
    async execute(_args, ctx) {
      const classifier = new ProjectClassifier()
      const profile = await classifier.classifyProject(ctx.directory)
      await db.putProject(ctx.directory, profile)
      return `Project classified: ${profile.language}/${profile.framework} (${profile.scope})`
    }
  }
}
```

**Pros:**
- Consistent with existing tool registration pattern
- Simple, no new abstraction
- Tool is available as `/init-project` in OpenCode

**Cons:**
- Index.ts grows slightly

#### Option B: Separate Module with Tool Factory

Create a function `createInitTool(db, classifier)` that returns the tool
definition. Import and spread into the tool object.

**Pros:** Keeps index.ts cleaner. Tool logic is isolated.
**Cons:** Over-abstraction for a single tool. More files to maintain.

**Recommendation: Option A (Inline Tool Definition)**

The existing `migrate-agent-tracker` tool is defined inline. Follow the same
pattern. The init-project tool is ~15 lines of code — not worth a separate
module.

---

### Decision 6: Auto-Classification Trigger

R12.7 says to auto-classify on `session.created` if the project is not yet
profiled. How to implement?

#### Option A: Check DB in session.created, classify if missing

```typescript
'session.created': async (session) => {
  // ... existing hooks ...
  await autoClassifyProject(directory)
}

async function autoClassifyProject(projectPath: string) {
  const existing = await db.getProject(projectPath)
  if (existing) {
    // Check if AGENTS.md changed (hash comparison)
    const currentHash = hashAgentsMd(projectPath)
    if (currentHash === existing.agentsmdHash) return
  }
  const classifier = new ProjectClassifier()
  const profile = await classifier.classifyProject(projectPath)
  await db.putProject(projectPath, profile)
}
```

**Pros:**
- Automatic, zero user action needed
- Hash comparison avoids unnecessary re-classification
- Fits naturally into existing session.created flow

**Cons:**
- Adds latency to session start (file reads + DB write)
- Should be fire-and-forget (wrapped in try/catch, never blocks session)

#### Option B: Lazy classification on first cross-project search

Only classify when another project actually searches for similar projects.

**Pros:** Zero overhead if cross-project search is never used.
**Cons:** Projects can't be found until some other project triggers a search.
Defeats the purpose of `/init`.

**Recommendation: Option A (Check DB on session.created)**

The whole point is that projects register themselves so OTHER projects can
find them later. This must be proactive, not lazy. File reads for AGENTS.md
and package.json are < 1ms. The DB write goes through the write buffer. Total
overhead is negligible.

---

### Edge Case Analysis

#### E1: No AGENTS.md and No Manifest File
Project has no recognizable files. All fields default to "unknown".
Profile is still stored — the project path is registered so it can be
found, even if classification is empty.

#### E2: AGENTS.md Exists but Has No Field Table
Free-form AGENTS.md without structured fields. Scanner finds nothing.
Language/framework/scope all default to "unknown". Manifest file may
still provide language and dependencies.

#### E3: Multiple Manifest Files (package.json AND Cargo.toml)
Monorepo or polyglot project. Use the first match in priority order
(package.json wins). The `manifestType` field records which one was used.

#### E4: Project Path Changes (Moved/Renamed Directory)
Old path remains in DB, new path gets a new entry. No automatic cleanup.
Stale entries are harmless — git log fallback will fail gracefully when
the old path no longer exists.

#### E5: Git Log Fallback on Non-Git Directory
`git -C /path log` fails with exit code 128. Catch error, skip this
project, continue with others. Return empty results for that path.

#### E6: Very Large AGENTS.md (> 100KB)
Unlikely but possible. Read only the first 10KB for classification.
The fields we need are always near the top (agent definition table).

#### E7: Concurrent Sessions Classifying Same Project
Two sessions start simultaneously for the same project. Both run
auto-classify. Both write the same profile. Last write wins — this is
fine because the profile is deterministic (same files = same result).

#### E8: Git Binary Not Available
`execSync('git ...')` throws. Catch error, return empty git log results.
Log a warning. The LMDB-based search is still available.

#### E9: Circular Similarity (Project A finds B, B finds A)
Not a problem. Cross-project search returns data FROM similar projects,
not a reference to them. There's no graph traversal.

#### E10: getAllProjects Returns Hundreds of Projects
Similarity scoring runs on all projects. With 100 projects, scoring is
100 comparisons — trivial. If it ever matters, pre-filter by language.

---

### Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| AGENTS.md parsing fails | Low | Medium | All fields default to "unknown" |
| Git log timeout (>5s) | Low | Low | execSync timeout option |
| No similar projects found | None | High (early) | Graceful empty result |
| LMDB 7th sub-db issue | Medium | Low | maxDbs already set to 10 |
| execSync blocks event loop | Low | Low | 5s timeout, only on fallback |
| Manifest JSON parse error | Low | Low | try/catch, default to "unknown" |
| Auto-classify slows session start | Low | Low | Fire-and-forget, <5ms |

---

### Trade-off Matrix

| Aspect | Chosen Approach | Alternative | Why |
|--------|----------------|-------------|-----|
| AGENTS.md parsing | Line-by-line scanner | Regex / AST | No deps, predictable, testable |
| Manifest support | JSON parse + detect others | All 7 full parse | 80/20 rule, deps contribute 0.1 to score |
| Git log strategy | --oneline + scoreEntry() | --grep, --format | Reuses existing code, ranked results |
| Git log caching | Always live | Session/LMDB cache | Fallback is rare, <100ms live |
| /init integration | Inline tool definition | Separate module | Follows existing pattern |
| Auto-classify | session.created check | Lazy on first search | Projects must register proactively |

---

**Architectural paths explored in BRAINSTORM.md. Use `architect-plan` to map the build.**
