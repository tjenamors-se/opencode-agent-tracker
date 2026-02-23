# SPECS.md - Database Configuration & Migration

**Status**: Draft
**Date**: 2026-02-23
**Scope**: LMDBDatabase path resolution, size limit, config support, data migration

---

## User Story

> As a user, I want to see what setup of agents I should use, so that I know how to configure for the next project.

This requires a single, central database that accumulates agent performance data across all projects -- not per-project silos that fragment the history.

---

## Problem Statement

The current `LMDBDatabase` has two bugs and one missing feature:

### Bug 1: Database path uses raw `~` string
**File**: `src/lmdb-database.ts:8`
**Current**: `constructor(private databasePath: string = '~/.config/opencode/agent-tracker.lmdb')`

Node.js does not expand `~`. LMDB treats this as a relative path from `process.cwd()`, creating a literal `~/.config/opencode/agent-tracker.lmdb` directory inside each project directory. This fragments data across projects and pollutes project trees.

### Bug 2: No database size limit
**File**: `src/lmdb-database.ts:14`
**Current**: `open({ path: this.databasePath, compression: true })`

LMDB defaults `mapSize` to ~10 GB. For a tracking plugin, this is excessive and risks consuming disk space silently.

### Missing: Configuration support
`PluginConfig.databasePath` is defined in `src/types.ts` but never consumed. The plugin entry point (`src/index.ts:11`) instantiates `new LMDBDatabase()` with no arguments, ignoring any user configuration.

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
- Reject values <= 0 or > 2 GB (2,147,483,648 bytes) with a clear error

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

---

## Constraints

| Constraint       | Value                                    |
|------------------|------------------------------------------|
| Max DB size      | 512 MB default, 2 GB hard ceiling        |
| Min DB size      | 1 MB (1,048,576 bytes) floor             |
| Path resolution  | `os.homedir()` + `path.join()`, no `~`   |
| Migration        | Additive only, no overwrites, idempotent |
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
- [ ] README documents both configuration options with examples
- [ ] All existing tests continue to pass
- [ ] New tests cover path resolution, size limit, config wiring, and migration

---

## Affected Files

| File                      | Change Type    |
|---------------------------|----------------|
| `src/lmdb-database.ts`    | Modify         |
| `src/index.ts`            | Modify         |
| `src/types.ts`            | Modify         |
| `README.md`               | Modify         |
| `tests/unit/lmdb-database.test.ts` | Modify |

---

## Out of Scope

- Automatic deletion of per-project databases after migration
- Database compaction or cleanup utilities
- Remote/network database support
- Schema versioning or format migration
