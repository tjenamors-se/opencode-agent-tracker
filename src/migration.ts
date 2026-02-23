import { open, RootDatabase } from 'lmdb'
import { join } from 'path'
import { existsSync, rmSync, statSync, readFileSync } from 'fs'
import type { Database } from './database.js'
import type { MigrationResult, MigrationRecord, AgentData, CommitData, CommunicationScoreEvent } from './types.js'

/**
 * The old buggy code used raw '~' in the path string, which Node.js does not
 * expand. LMDB treated it as a relative path from process.cwd(), creating a
 * literal '~/.config/opencode/agent-tracker.lmdb' directory inside each
 * project. We intentionally use the same literal '~' here so we can detect
 * and migrate those broken per-project databases.
 */
const OLD_DB_RELATIVE_PATH = join('~', '.config', 'opencode', 'agent-tracker.lmdb')

/**
 * Detection result for an old per-project database.
 */
export interface DetectionResult {
  tildeExists: boolean
  hasLmdb: boolean
  alreadyMigrated: boolean
  lmdbPath: string
}

/**
 * Reads the package version from package.json.
 * Uses __dirname (available in CJS and babel-transformed ESM).
 */
function getPackageVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }
    return pkg.version
  } catch {
    return 'unknown'
  }
}

/**
 * Detects whether an old per-project database exists at the given directory.
 * Checks the LMDB migration sub-db to see if this directory was already migrated.
 *
 * @param sourceDir - Project directory to check
 * @param targetDb - Central database to check for existing migration record
 * @returns Detection result with existence, LMDB presence, and migration status
 */
export async function detectOldDatabase(
  sourceDir: string,
  targetDb: Database
): Promise<DetectionResult> {
  const tildeDir = join(sourceDir, '~')
  const lmdbPath = join(sourceDir, OLD_DB_RELATIVE_PATH)

  const tildeExists = existsSync(tildeDir)

  if (!tildeExists) {
    return { tildeExists: false, hasLmdb: false, alreadyMigrated: false, lmdbPath }
  }

  const hasLmdb = existsSync(lmdbPath) && !statSync(lmdbPath).isDirectory()

  let alreadyMigrated = false
  if (targetDb && targetDb.isAvailable) {
    const record = await targetDb.getMigration(sourceDir)
    alreadyMigrated = record !== null
  }

  return { tildeExists, hasLmdb, alreadyMigrated, lmdbPath }
}

/**
 * Migrates data from a per-project database (old prefix-based format)
 * to the centralized sub-database architecture (R4).
 * After successful migration, stores a migration record and removes the old ./~ directory tree.
 *
 * @param sourceDir - Project directory where old DB may exist
 * @param targetDb - Central database implementing the Database interface
 * @returns Migration result with counts and any errors
 */
export async function migrateFromProjectDatabase(
  sourceDir: string,
  targetDb: Database
): Promise<MigrationResult> {
  const result: MigrationResult = {
    entriesMigrated: 0,
    entriesSkipped: 0,
    errors: []
  }

  if (!targetDb) {
    result.errors.push('Target database is undefined')
    return result
  }

  if (!targetDb.isAvailable) {
    result.errors.push('Target database is not available')
    return result
  }

  const sourcePath = join(sourceDir, OLD_DB_RELATIVE_PATH)

  if (!existsSync(sourcePath)) {
    return result
  }

  let sourceDb: RootDatabase | null = null
  let migrationSucceeded = false

  try {
    sourceDb = open({
      path: sourcePath,
      readOnly: true,
      maxDbs: 1
    })

    for (const { key, value } of sourceDb.getRange()) {
      const keyStr = String(key)

      try {
        await routeEntry(keyStr, value, targetDb, result)
      } catch (error) {
        result.errors.push(`Failed to migrate key "${keyStr}": ${String(error)}`)
      }
    }

    migrationSucceeded = true
  } catch (error) {
    result.errors.push(`Migration failed: ${String(error)}`)
  } finally {
    if (sourceDb) {
      try {
        sourceDb.close()
      } catch (_closeError) {
        // Ignore close errors
      }
    }
  }

  if (migrationSucceeded) {
    await storeMigrationRecord(sourceDir, result.entriesMigrated, targetDb)
    cleanupOldDatabase(sourceDir, result)
  }

  return result
}

/**
 * Stores a migration record in the central database after successful migration.
 */
async function storeMigrationRecord(
  sourceDir: string,
  entriesMigrated: number,
  targetDb: Database
): Promise<void> {
  const record: MigrationRecord = {
    sourcePath: sourceDir,
    version: getPackageVersion(),
    timestamp: new Date(),
    entriesMigrated
  }
  await targetDb.putMigration(sourceDir, record)
}

/**
 * Removes the old ./~ directory tree after a successful migration.
 * Errors during cleanup are recorded but do not fail the migration.
 */
function cleanupOldDatabase(sourceDir: string, result: MigrationResult): void {
  const oldRoot = join(sourceDir, '~')
  try {
    rmSync(oldRoot, { recursive: true, force: true })
  } catch (error) {
    result.errors.push(`Failed to remove old database directory "${oldRoot}": ${String(error)}`)
  }
}

/**
 * Routes a single entry from the old prefix-based format to the correct
 * sub-database method on the target. Uses check-then-put for idempotency
 * (ifNoExists() is not available in LMDB 3.x).
 */
async function routeEntry(
  key: string,
  value: unknown,
  targetDb: Database,
  result: MigrationResult
): Promise<void> {
  if (key.startsWith('agent:')) {
    const agentId = key.slice('agent:'.length)
    const existing = await targetDb.getAgent(agentId)
    if (existing) {
      result.entriesSkipped += 1
      return
    }
    await targetDb.putAgent(agentId, value as AgentData)
    result.entriesMigrated += 1
  } else if (key.startsWith('commit:')) {
    const rest = key.slice('commit:'.length)
    const separatorIdx = rest.indexOf(':')
    if (separatorIdx === -1) {
      result.errors.push(`Invalid commit key format: "${key}"`)
      return
    }
    const projectPath = rest.slice(0, separatorIdx)
    const commitHash = rest.slice(separatorIdx + 1)
    const existing = await targetDb.getCommit(projectPath, commitHash)
    if (existing) {
      result.entriesSkipped += 1
      return
    }
    await targetDb.putCommit(projectPath, commitHash, value as CommitData)
    result.entriesMigrated += 1
  } else if (key.startsWith('communication:')) {
    await targetDb.putCommunicationEvent(value as CommunicationScoreEvent)
    result.entriesMigrated += 1
  } else {
    result.errors.push(`Unknown key prefix: "${key}"`)
  }
}
