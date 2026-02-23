# SPECS.md - Database Configuration & Migration

**Status**: Draft
**Date**: 2026-02-23
**Scope**: LMDBDatabase path resolution, size limit, config support, data migration, write optimization, grading, agent state management

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

### Bug 4: Agent state managed outside the plugin
**Files**: `.agent/status.json`, `.journal/communication.json`, `.journal/YYYY-MM-DD.md`

Agent state (SP, XP, CS, commit counts, communication history, journal entries) is currently managed by manually writing JSON files from the shell via `cat` and `EOF`. This is:
- **Error-prone**: Manual JSON construction can produce invalid state, wrong values, or missed updates
- **Disconnected**: The `TrackingService` tracks the same data in LMDB but the project-local files are a separate, unsynchronized copy
- **Not the plugin's job to delegate to shell**: The plugin should expose functions that the agent (or hooks) call to update state -- the plugin is the single source of truth

The `TrackingService` already has `incrementXP`, `incrementCommitCount`, `updateCommunicationScore`, and `recordCommunicationScore` -- but these only write to LMDB. The project-local state files (`.agent/status.json`, `.journal/`) are not managed by any code.

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

### R8: Agent state management via TrackingService functions
The `TrackingService` MUST be the single owner of agent state. No external process (shell, agent, user) should write state files directly. Instead, the plugin exposes functions that manage all state transitions.

#### R8.1: Status management
The `TrackingService` MUST provide methods to read and update agent status:
- `getAgentStatus(agentId: string): Promise<AgentStatus>` -- returns current SP, XP, CS, commits, bugs, halted state
- `reportBug(agentId: string): Promise<void>` -- decrements SP by 1, records the bug, checks for halt condition (SP <= 0)
- `recordCommitGrade(agentId: string, commitHash: string, agentGrade: Grade, userGrade: Grade): Promise<void>` -- applies both grades to CS, stores retrospective entry, increments XP (+1 for successful commit)

These methods buffer writes (per R6) -- they mutate in-memory state and flush on push/session end.

#### R8.2: Communication journal management
The `TrackingService` MUST provide a method to record retrospective entries:
- `recordRetrospective(entry: RetrospectiveEntry): Promise<void>` -- stores the retrospective in the write buffer
- `RetrospectiveEntry` type:
  ```
  {
    commit: string
    timestamp: string (ISO 8601)
    task: string
    agent_grade: Grade
    user_grade: Grade
    score_before: number
    score_after: number
    agent_note: string
    user_note: string
  }
  ```
- Retrospective history is stored in LMDB under `retrospective:<agent_id>:<commit_hash>` keys
- No more manual `.journal/communication.json` file -- LMDB is the source of truth

#### R8.3: Activity journal management
The `TrackingService` MUST provide a method to log activity:
- `logActivity(agentId: string, entry: ActivityEntry): Promise<void>` -- stores activity in the write buffer
- `ActivityEntry` type:
  ```
  {
    timestamp: string (ISO 8601)
    task: string
    actions: string
    outcome: string
    decisions: string
  }
  ```
- Activity entries are stored in LMDB under `activity:<agent_id>:<timestamp>` keys
- No more manual `.journal/YYYY-MM-DD.md` files -- LMDB is the source of truth

#### R8.4: Project-local state files become read-only exports
- `.agent/status.json` and `.journal/` files are NO LONGER the source of truth
- The plugin MAY export/sync these files from LMDB for external tool consumption (e.g., so the agent can read `.agent/status.json`), but writes MUST go through `TrackingService` methods
- Export is optional and happens during flush (R6), not on every mutation

#### R8.5: Grade type
Define a shared `Grade` type used across all grading:
```
type Grade = -1 | 1 | 2 | 5
```
Map to labels: `{ [-1]: 'bad', [1]: 'neutral', [2]: 'good', [5]: 'excellence' }`

#### Affected files
| File | Change |
|------|--------|
| `src/tracking-service.ts` | Add `getAgentStatus`, `reportBug`, `recordCommitGrade`, `recordRetrospective`, `logActivity` |
| `src/types.ts` | Add `Grade`, `RetrospectiveEntry`, `ActivityEntry`, `AgentStatus` types |
| `src/index.ts` | Wire new methods to appropriate hooks |
| `src/lmdb-database.ts` | Add `putRetrospective`, `getRetrospectives`, `putActivity`, `getActivities` methods |
| `src/database.ts` | Extend `Database` interface with new methods |

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
| State ownership  | TrackingService is single source of truth |
| Grade range      | -1, 1, 2, 5                             |
| CS range per commit | -2 to +10 (both parties grade)        |
| Error handling   | Graceful degradation, never crash host   |
| Backwards compat | Existing `Database` interface extended, not broken |
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
- [ ] `getAgentStatus` returns current agent state from LMDB
- [ ] `reportBug` decrements SP and checks halt condition
- [ ] `recordCommitGrade` applies both agent and user grades to CS
- [ ] `recordRetrospective` stores entry in LMDB under `retrospective:` key
- [ ] `logActivity` stores entry in LMDB under `activity:` key
- [ ] No agent state is written via shell commands or direct file manipulation
- [ ] Project-local `.agent/status.json` is derived from LMDB, not the reverse
- [ ] README documents both configuration options with examples
- [ ] All existing tests continue to pass
- [ ] New tests cover path resolution, size limit, config wiring, migration, write batching, excellence grade, and state management functions

---

## Affected Files

| File                      | Change Type    | Requirements       |
|---------------------------|----------------|--------------------|
| `src/lmdb-database.ts`    | Modify         | R1, R2, R3, R4, R6, R8 |
| `src/tracking-service.ts` | Modify         | R6, R7, R8         |
| `src/index.ts`            | Modify         | R3, R6, R8         |
| `src/types.ts`            | Modify         | R2, R3, R7, R8     |
| `src/database.ts`         | Modify         | R8                 |
| `README.md`               | Modify         | R5                 |
| `tests/unit/lmdb-database.test.ts` | Modify | R1, R2, R4, R6, R8 |
| `tests/unit/tracking-service.test.ts` | Modify | R6, R7, R8      |

---

## Out of Scope

- Automatic deletion of per-project databases after migration
- Database compaction or cleanup utilities
- Remote/network database support
- Schema versioning or format migration
- Read-side caching (unnecessary -- LMDB reads are already memory-mapped)

---

# SPECS: NPM Postinstall Setup (R9)

**Status**: Draft
**Date**: 2026-02-23
**Scope**: Automated installation of plugin, skills, agent definitions, and scoring system via npm postinstall

---

## User Story

> As a user, I want an installation that creates the skills, adds the agents in opencode.json, adds the plugin, and copies the plugin itself to the plugin directory, so that I get a fully configured agent tracking environment with a single `npm install`.

---

## Problem Statement

Currently the plugin is loaded via a `file://` path in `opencode.json`, skills are manually placed in `~/.config/opencode/skills/`, agent definitions are manually added to `opencode.json`, and the scoring system (AGENTS.md) is manually maintained. A new user must perform 5+ manual steps to get a working setup. This should be automated via an npm postinstall script.

---

## Requirements

### R9: NPM Postinstall Script

A single postinstall script (`scripts/postinstall.mjs`) that runs after `npm install` and performs the following actions in order:

#### R9.1: Copy plugin to plugins directory
- Copy the contents of the package's `dist/` directory to `~/.config/opencode/plugins/agent-tracker/`
- Create the target directory (and parents) if it does not exist
- Overwrite existing files (the plugin itself should always be the latest version)
- Use `os.homedir()` and `path.join()` for path resolution (no raw `~`)

#### R9.2: Install skills
- Bundle the following skill directories inside the npm package (in a `skills/` directory at the package root):
  - `skills/agile-spec-to-build/SKILL.md`
  - `skills/structured-review/SKILL.md`
- Copy each skill directory to `~/.config/opencode/skills/<skill-name>/`
- **Skip if the skill directory already exists** -- do not overwrite user customizations
- Print a message indicating whether each skill was installed or skipped

#### R9.3: Install agent definitions
- Bundle agent definitions inside the npm package (in `agents/agents.json`)
- The 4 agent definitions: `spec-agent`, `brainstorm`, `architect-plan`, `engineer-build`
- Read the user's `~/.config/opencode/opencode.json`
- If the file does not exist, create it with a minimal valid structure
- For each agent definition:
  - **Skip if the agent key already exists** in the user's config -- do not overwrite
  - **Add if not present**
- Write the updated config back to disk
- Print a message indicating whether each agent was added or skipped

#### R9.4: Register plugin in opencode.json
- Read the `plugin` array from `~/.config/opencode/opencode.json`
- The plugin path should reference the copied location: `~/.config/opencode/plugins/agent-tracker`
- **Only add if not already present** in the array (check by path suffix `plugins/agent-tracker` or exact match)
- Also remove any stale `file://` dev paths pointing to the source repo
- Write the updated config back to disk

#### R9.5: Install AGENTS.md scoring system
- Bundle the scoring system content inside the npm package (in `agents/TRACK_AGENTS.md`)
- **If `~/.config/opencode/AGENTS.md` exists**:
  - Read the existing file
  - Merge in the scoring system sections that do not already exist (detect by heading markers)
  - Write back the merged file
  - Print a message indicating what was merged
- **If `~/.config/opencode/AGENTS.md` does NOT exist**:
  - Copy `TRACK_AGENTS.md` content as `~/.config/opencode/AGENTS.md`
  - Print a message indicating the file was created

#### R9.6: CI/Non-interactive detection
- Detect non-interactive environments via:
  - `process.env.CI` is set
  - `process.env.NONINTERACTIVE` is set
  - `!process.stdin.isTTY`
- In non-interactive mode: auto-apply "skip-if-exists" defaults for all operations
- In interactive mode: same behavior (skip-if-exists), but print informational messages to stdout

#### R9.7: Error handling
- The postinstall script MUST NOT cause `npm install` to fail
- All operations should be wrapped in try/catch
- Errors are logged to stderr with clear messages
- The script exits with code 0 even on partial failure
- Each operation is independent -- failure of one does not prevent others

---

## Package Changes

### Files to bundle in npm package
| Path (in package)                        | Source                                                      |
|------------------------------------------|-------------------------------------------------------------|
| `dist/`                                  | Built plugin files (already bundled)                        |
| `skills/agile-spec-to-build/SKILL.md`    | Copy from `~/.config/opencode/skills/agile-spec-to-build/`  |
| `skills/structured-review/SKILL.md`      | Copy from `~/.config/opencode/skills/structured-review/`     |
| `agents/agents.json`                     | Extract from `~/.config/opencode/opencode.json` agent block  |
| `agents/TRACK_AGENTS.md`                 | Scoring system content (derived from project AGENTS.md)      |
| `scripts/postinstall.mjs`               | The postinstall script itself                                |

### package.json changes
```json
{
  "files": ["dist", "skills", "agents", "scripts/postinstall.mjs"],
  "scripts": {
    "postinstall": "node scripts/postinstall.mjs"
  }
}
```

---

## Constraints

| Constraint              | Value                                                    |
|-------------------------|----------------------------------------------------------|
| Path resolution         | `os.homedir()` + `path.join()`, never raw `~`            |
| Conflict resolution     | Skip-if-exists for skills, agents, plugin entry          |
| Plugin files             | Always overwrite (latest version wins)                   |
| AGENTS.md               | Merge if exists, create if not                           |
| Error behavior          | Never fail npm install (exit 0 always)                   |
| CI detection            | `CI`, `NONINTERACTIVE` env vars, `!process.stdin.isTTY` |
| Node.js                 | >=18.0.0 (can use fs/promises, ESM)                      |
| Script format           | ESM (.mjs) -- no build step needed for postinstall       |
| No dependencies         | Postinstall uses only Node.js built-ins (fs, path, os)   |

---

## Validation Criteria

- [ ] `npm install` runs postinstall without errors
- [ ] Plugin files copied to `~/.config/opencode/plugins/agent-tracker/`
- [ ] Skills copied to `~/.config/opencode/skills/` (skipped if exists)
- [ ] Agent definitions added to `opencode.json` (skipped if exists)
- [ ] Plugin registered in `opencode.json` plugin array (skipped if present)
- [ ] AGENTS.md created or merged at `~/.config/opencode/AGENTS.md`
- [ ] Stale `file://` dev paths removed from plugin array
- [ ] Non-interactive mode works without prompts
- [ ] Script exits 0 even on partial failure
- [ ] Running postinstall twice is idempotent (skip-if-exists)
- [ ] All existing tests continue to pass

---

## Out of Scope

- Uninstall script
- Per-project init command
- Interactive prompts for conflict resolution
- Windows support (future consideration)

---

## R10: Health Status Display Redesign (FIGlet + Tron RPG Player Sheet)

**User Story:** As a user, I want the agent health status displayed as a Tron-style RPG player sheet with FIGlet ASCII art agent name, so that the status looks cool and the box alignment bug is fixed.

### R10.1: FIGlet Agent Name Header
- Agent name rendered using the `figlet` npm package with `Cybermedium` font
- Output must fit within 60 columns max width
- If agent name is too long for 60 columns, fall back gracefully (truncate or use smaller font)

### R10.2: Tron RPG Player Sheet Layout
- Stats presented in a minimalist Tron-themed layout
- **No borders** — use indentation and spacing only (no Unicode box-drawing characters)
- Max width: 60 columns
- Must render correctly in:
  - OpenCode TUI toast (`client.tui.toast.show`)
  - Chat code blocks (monospace markdown)
  - Terminal stdout

### R10.3: Stats Content
- **Trust Tier label** derived from SP (PROBATION, JUNIOR, ESTABLISHED, SENIOR, EXPERT)
- **XP progress bar** showing progress toward next SP level-up (`10 * current_SP` XP threshold)
- SP, XP, CS values (1-decimal floats)
- Commits and Bugs counts (1-decimal floats)
- Halted status (YES/no)
- Pending changes (count + list if any)

### R10.4: ASCII Progress Bar
- Visual bar showing XP progress toward SP level-up threshold
- Pure ASCII characters only (e.g., `[====------]` or similar)
- Percentage display alongside bar

### R10.5: No Unicode Box-Drawing
- Must NOT use any Unicode box-drawing characters (U+2500-U+257F range)
- All visual structure via ASCII-only characters, spacing, and indentation
- This fixes the East Asian Width alignment bug permanently

### R10.6: Dependencies
- Add `figlet` (^1.10.0) as a runtime dependency
- Add `@types/figlet` as a devDependency
- `figlet.textSync()` for synchronous rendering (formatHealthStatus is sync)

### R10.7: Backward Compatibility
- `formatHealthStatus()` signature unchanged: `(health: AgentHealthStatus) => string`
- Same call sites in `guardAgentHealth()` and `showHealthStatus()`
- No changes to `AgentHealthStatus` type

---

## Constraints

| Constraint              | Value                                    |
|-------------------------|------------------------------------------|
| FIGlet font             | Cybermedium                              |
| Max width               | 60 columns                               |
| Border style            | None — spacing/indentation only          |
| Progress bar            | Pure ASCII                               |
| Unicode box-drawing     | FORBIDDEN (U+2500-U+257F)               |
| Function signature      | Unchanged                                |
| Dependencies            | figlet (runtime), @types/figlet (dev)    |

---

## Validation Criteria

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (all 138+ tests)
- [ ] `formatHealthStatus()` output contains FIGlet-rendered agent name
- [ ] Output fits within 60 columns
- [ ] No Unicode box-drawing characters in output
- [ ] Trust tier label displayed correctly for each SP range
- [ ] XP progress bar renders correctly
- [ ] All existing call sites work without changes
