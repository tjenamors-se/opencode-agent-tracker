# SPECS.md - Database Configuration & Migration

**Status**: Draft
**Date**: 2026-02-23
**Scope**: LMDBDatabase path resolution, size limit, config support, data migration, write optimization, grading

---

## User Story

> As a user, I want to see what setup of agents I should use, so that I know how to configure for the next project.

This requires a single, central database that accumulates agent performance data across all projects -- not per-project silos that fragment the history.

---

## Problem Statement

The current `LMDBDatabase` has two bugs and several missing features:

### Bug 1: Database path uses raw `~` string
**File**: `src/lmdb-database.ts:8`
**Current**: `constructor(private databasePath: string = '~/.config/opencode/agent-tracker.lmdb')`

Node.js does not expand `~`. LMDB treats this as a relative path from `process.cwd()`, creating a literal `~/.config/opencode/agent-tracker.lmdb` directory inside each project directory. This fragments data across projects and pollutes project trees.

### Bug 2: No database size limit
**File**: `src/lmdb-database.ts:14`
**Current**: `open({ path: this.databasePath, compression: true })`

LMDB defaults `mapSize` to ~10 GB. For a tracking plugin, this is excessive and risks consuming disk space silently.

### Bug 3: Excessive database writes
**File**: `src/tracking-service.ts`

Every hook call (`tool.execute.after`, `command.executed`, etc.) triggers an immediate `putAgent` write. A single commit cycle can produce 4+ individual writes. LMDB writes are expensive (fsync, copy-on-write B-tree updates) while reads are essentially free (memory-mapped). The current pattern treats writes as cheap, which they are not.

Current write points per commit cycle:
- `trackToolUsage` -> `incrementXP` -> `putAgent` (per tool call)
- `trackCommandCompletion` -> `incrementXP` -> `putAgent` (per command)
- `commitCompleted` -> `putCommit` + `incrementXP` -> `putAgent` + `incrementCommitCount` -> `putAgent` (3 writes)
- `recordCommunicationScore` -> `putCommunicationEvent` + `updateCommunicationScore` -> `putAgent` (2 writes)

### Missing: Configuration support
`PluginConfig.databasePath` is defined in `src/types.ts` but never consumed. The plugin entry point (`src/index.ts:11`) instantiates `new LMDBDatabase()` with no arguments, ignoring any user configuration.

### Missing: Excellence grade
The communication scoring system only supports Bad (-1), Neutral (+1), and Good (+2). There is no grade for exceptional collaboration.

---

## Requirements

### R1: Central database via `os.homedir()`
- **Default path**: `path.join(os.homedir(), '.config', 'opencode', 'agent-tracker.lmdb')`
- Resolve using Node.js `os.homedir()` and `path.join()` -- never raw `~`
- Create parent directories if they do not exist (`fs.mkdirSync` with `recursive: true`)
- The database MUST be shared across all projects to enable cross-project agent analysis

### R2: Configurable database size limit
- **Default**: 512 MB (`512 * 1024 * 1024` bytes)
- Pass as `mapSize` to LMDB `open()`
- Make configurable via `PluginConfig.maxDatabaseSize` (number, in bytes)
- Reject values outside 1 MB..2 GB range with a clear error

### R3: Configurable database path
- `PluginConfig.databasePath` override MUST be supported
- If provided, use the user-specified path instead of the default
- The user-specified path MUST be treated as absolute; if relative, resolve against `os.homedir()`
- Wire `PluginConfig` from the plugin context into `LMDBDatabase` constructor

### R4: Merge migration from per-project databases
- On initialization, detect if a per-project database exists at `<cwd>/~/.config/opencode/agent-tracker.lmdb`
- If found, perform a diff-merge migration:
  - Read all entries from the per-project (source) database
  - For each entry, check if it already exists in the central (target) database
  - Only write entries that do NOT exist in the target (additive merge, no overwrites)
  - Key comparison is by full LMDB key (`agent:*`, `commit:*`, `communication:*`)
- After successful migration, log a message indicating how many entries were migrated
- Do NOT delete the source database automatically -- leave cleanup to the user
- Migration MUST be idempotent: running it twice produces the same result
- Migration errors MUST NOT prevent the plugin from starting (log and continue)

### R5: Update README.md configuration documentation
- Document `databasePath` config option (string, optional, default home directory path)
- Document `maxDatabaseSize` config option (number, optional, default 512 MB, max 2 GB)
- Show example OpenCode plugin configuration with both options

### R6: Write batching -- reads are free, writes on push only
LMDB is memory-mapped: reads are a pointer dereference (essentially free). Writes are expensive (fsync, B-tree copy-on-write, transaction overhead). The tracking service MUST be restructured to:

- **Read freely**: All `getAgent`, `getCommit`, `getCommunicationEvents` calls remain immediate. No caching needed -- LMDB reads are already near-RAM speed.
- **Buffer writes in memory**: Instead of calling `putAgent`/`putCommit`/`putCommunicationEvent` on every hook, accumulate changes in an in-memory buffer (a `Map` or plain object).
- **Flush on push**: Write all buffered data to LMDB in a single batch transaction when a `git push` event occurs. This collapses N individual writes into one atomic transaction.
- **Flush on session end**: If the session ends before a push, flush the buffer during `session.deleted` as a safety net so data is not lost.
- **Buffer structure**: The write buffer holds pending mutations keyed by LMDB key. Multiple updates to the same agent within a session collapse into one write (last-write-wins within the buffer).
- **Hook changes**:
  - `tool.execute.after` -> buffer XP increment, do NOT write
  - `command.executed` -> buffer XP increment, do NOT write
  - `commitCompleted` -> buffer commit data + XP + commit count, do NOT write
  - `recordCommunicationScore` -> buffer CS event + score update, do NOT write
  - `session.deleted` / push event -> flush all buffered writes in one LMDB transaction
- **New method**: `flushWriteBuffer(): Promise<void>` -- writes all pending data in a single LMDB transaction, then clears the buffer.
- **Transaction**: Use LMDB's `transaction()` or batch `put()` to write all buffered entries atomically. If any entry fails, log the error and continue with remaining entries.

#### Affected files
| File | Change |
|------|--------|
| `src/tracking-service.ts` | Add write buffer, change all writes to buffer, add `flushWriteBuffer()` |
| `src/index.ts` | Wire push hook to call `flushWriteBuffer()`, wire `session.deleted` to flush |
| `src/lmdb-database.ts` | Add `putBatch()` method for atomic multi-key writes |

### R7: Excellence grade for communication scoring
Add a new grade tier for exceptional collaboration:

| Grade         | Points | When to use                                                |
|---------------|--------|------------------------------------------------------------|
| **Bad**       | -1     | Miscommunication, wrong assumptions, wasted work           |
| **Neutral**   | +1     | Acceptable, nothing special, still learning                |
| **Good**      | +2     | Clear communication, correct execution, smooth             |
| **Excellence**| +5     | Outstanding collaboration, proactive problem-solving, deep understanding of intent, exceeded expectations |

- Update `CommunicationScoreEvent.grade` type from `-1 | 1 | 2` to `-1 | 1 | 2 | 5`
- Update `TrackingService.recordCommunicationScore` to accept the new grade value
- Update any grade validation logic to include `5`
- Both agent and user can award Excellence, so each commit can adjust CS by -2 to +10

#### Affected files
| File | Change |
|------|--------|
| `src/types.ts` | Update `grade` type to `-1 \| 1 \| 2 \| 5` |
| `src/tracking-service.ts` | Accept grade `5` in `recordCommunicationScore` |

---

## Constraints

| Constraint       | Value                                    |
|------------------|------------------------------------------|
| Max DB size      | 512 MB default, 2 GB hard ceiling        |
| Min DB size      | 1 MB (1,048,576 bytes) floor             |
| Path resolution  | `os.homedir()` + `path.join()`, no `~`   |
| Migration        | Additive only, no overwrites, idempotent |
| Write strategy   | Buffer in memory, flush on push/session end |
| Read strategy    | Always immediate, no caching needed      |
| Grade range      | -1, 1, 2, 5                             |
| CS range per commit | -2 to +10 (both parties grade)        |
| Error handling   | Graceful degradation, never crash host   |
| Backwards compat | Existing `Database` interface unchanged  |
| Node.js          | >=18.0.0                                 |

---

## Validation Criteria

- [ ] `LMDBDatabase` default path resolves to `$HOME/.config/opencode/agent-tracker.lmdb`
- [ ] `LMDBDatabase` with custom path uses the provided path
- [ ] `mapSize` defaults to 512 MB
- [ ] `mapSize` rejects values outside 1 MB..2 GB range
- [ ] Plugin reads `databasePath` and `maxDatabaseSize` from config context
- [ ] Migration detects `<cwd>/~/.config/opencode/agent-tracker.lmdb`
- [ ] Migration only adds entries not present in central DB
- [ ] Migration is idempotent
- [ ] Migration failure does not prevent plugin startup
- [ ] `trackToolUsage` does NOT write to LMDB
- [ ] `trackCommandCompletion` does NOT write to LMDB
- [ ] `commitCompleted` does NOT write to LMDB
- [ ] `flushWriteBuffer` writes all buffered data in one transaction
- [ ] Push event triggers `flushWriteBuffer`
- [ ] `session.deleted` triggers `flushWriteBuffer` as safety net
- [ ] Multiple updates to the same agent key collapse into one write
- [ ] Grade value `5` (Excellence) is accepted by `recordCommunicationScore`
- [ ] `CommunicationScoreEvent.grade` type includes `5`
- [ ] CS adjustment per commit ranges from -2 to +10
- [ ] README documents both configuration options with examples
- [ ] All existing tests continue to pass
- [ ] New tests cover path resolution, size limit, config wiring, migration, write batching, and excellence grade

---

## Affected Files

| File                      | Change Type    | Requirements |
|---------------------------|----------------|--------------|
| `src/lmdb-database.ts`    | Modify         | R1, R2, R3, R4, R6 |
| `src/tracking-service.ts` | Modify         | R6, R7       |
| `src/index.ts`            | Modify         | R3, R6       |
| `src/types.ts`            | Modify         | R2, R3, R7   |
| `README.md`               | Modify         | R5           |
| `tests/unit/lmdb-database.test.ts` | Modify | R1, R2, R4, R6 |
| `tests/unit/tracking-service.test.ts` | Modify | R6, R7    |

---

## Out of Scope

- Automatic deletion of per-project databases after migration
- Database compaction or cleanup utilities
- Remote/network database support
- Schema versioning or format migration
- Read-side caching (unnecessary -- LMDB reads are already memory-mapped)
