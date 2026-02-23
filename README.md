# @tjenamors.se/opencode-agent-tracker

High-performance agent tracking for OpenCode using LMDB. This plugin replaces JSON-based tracking with memory-mapped database storage for near-RAM performance.

## Quick Start

```bash
npm install @tjenamors.se/opencode-agent-tracker
```

## Features

- **LMDB Storage**: Memory-mapped database with sub-database architecture for near-RAM speed
- **XP/SP Tracking**: Skill point and experience point tracking with leveling system
- **Communication Scoring**: Tracks collaboration quality with Bad/Neutral/Good/Excellence grading
- **Write Batching**: Buffers writes in memory and flushes on session end for reduced I/O
- **Migration**: Automatically migrates data from per-project databases to centralized storage
- **Graceful Degradation**: Continues working when LMDB is unavailable
- **.env Protection**: Blocks agent access to environment files
- **TypeScript Native**: Full type safety with strict mode

## Configuration

Add configuration to your OpenCode config file (`~/.config/opencode/config.yaml` or equivalent):

```yaml
plugins:
  agent-tracker:
    databasePath: "~/.config/opencode/agent-tracker.lmdb"
    maxDatabaseSize: 536870912
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `databasePath` | `string` | `~/.config/opencode/agent-tracker.lmdb` | Path to the LMDB database file. Resolved relative to the user's home directory. |
| `maxDatabaseSize` | `number` | `536870912` (512 MB) | Maximum database size in bytes. Range: 1 MB to 2 GB. |

The database is centralized by default -- all projects share a single database in the user's home directory. This enables cross-project agent performance comparison.

### Migration from Per-Project Databases

If the plugin detects an old per-project database at `<project>/.config/opencode/agent-tracker.lmdb`, it will automatically perform an additive merge migration on startup. Existing entries in the central database are not overwritten. The source database is left intact for manual cleanup.

## Local Testing

```bash
# Build and create symlink to OpenCode plugins directory
npm run setup-local

# Test without OpenCode
npm run test-local
```

### Development Commands

```bash
npm run typecheck    # TypeScript type checking
npm test             # Run unit tests
npm run test:coverage # Coverage report (80% minimum)
npm run lint         # ESLint
npm run build        # Build to dist/
npm run clean        # Remove build artifacts
```

## Architecture

The plugin uses five LMDB sub-databases:

- **agents** -- Agent state (SP, XP, CS, commits, bugs)
- **commits** -- Commit metadata keyed by project and hash
- **communication** -- Communication score events
- **retrospectives** -- Per-commit retrospective entries
- **activities** -- Activity journal entries

All writes are buffered in memory via `WriteBuffer` and flushed to disk on session end or explicit flush. Reads are synchronous (memory-mapped) and free.

## License

GNU General Public License v3.0 or later - See [LICENSE](./LICENSE) for details.
