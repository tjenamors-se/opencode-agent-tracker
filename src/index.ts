import type { Plugin } from '@opencode-ai/plugin'
import { LMDBDatabase } from './lmdb-database.js'
import { TrackingService } from './tracking-service.js'
import { WriteBuffer } from './write-buffer.js'
import { DependencyChecker } from './dependency-checker.js'
import { EnvProtection } from './env-protection.js'
import { migrateFromProjectDatabase, detectOldDatabase } from './migration.js'
import type { PluginConfig, DatabaseConfig, AgentHealthStatus } from './types.js'

export { migrateFromProjectDatabase, detectOldDatabase } from './migration.js'

/**
 * Resolves PluginConfig to DatabaseConfig for LMDBDatabase constructor.
 */
function resolveDatabaseConfig(pluginConfig: PluginConfig): DatabaseConfig {
  const config: DatabaseConfig = {}
  if (pluginConfig.databasePath !== undefined) {
    config.path = pluginConfig.databasePath
  }
  if (pluginConfig.maxDatabaseSize !== undefined) {
    config.maxSize = pluginConfig.maxDatabaseSize
  }
  return config
}

/**
 * Formats AgentHealthStatus into a human-readable status block for toasts/logs.
 */
function formatHealthStatus(health: AgentHealthStatus): string {
  const lines: string[] = []
  lines.push(`--- Agent Status: ${health.agent_id} ---`)
  lines.push(`SP: ${health.skill_points} | XP: ${health.experience_points} | CS: ${health.communication_score}`)
  lines.push(`Commits: ${health.total_commits} | Bugs: ${health.total_bugs}`)
  lines.push(`Halted: ${health.halted ? 'YES' : 'no'}`)
  if (health.pending_changes.length > 0) {
    lines.push(`Pending changes (${health.pending_changes.length}):`)
    for (const change of health.pending_changes) {
      lines.push(`  ${change}`)
    }
  } else {
    lines.push('Pending changes: none')
  }
  return lines.join('\n')
}

const AgentTrackerPlugin: Plugin = async (context: any) => {
  const { project, client, directory } = context

  const pluginConfig: PluginConfig = context.$ ?? {}
  const dbConfig = resolveDatabaseConfig(pluginConfig)

  const db = new LMDBDatabase(dbConfig)
  const writeBuffer = new WriteBuffer()
  const dependencyChecker = new DependencyChecker(client)
  const trackingService = new TrackingService(db, writeBuffer, client)
  const envProtection = new EnvProtection()

  await client.app.log({
    body: {
      service: 'agent-tracker',
      level: 'info',
      message: 'Agent tracker plugin initialized',
      extra: {
        databaseAvailable: db.isAvailable,
        directory,
        project: project?.name || 'unknown'
      }
    }
  })

  /**
   * Checks agent health and blocks execution if halted.
   * Shows toast with full status menu when agent is halted.
   * @returns true if the agent is halted and the event should be blocked
   */
  async function guardAgentHealth(source: any): Promise<boolean> {
    const agentId = source?.agentId || source?.agent?.id || null
    if (!agentId) return false
    if (!db.isAvailable) return false

    try {
      const health = await trackingService.checkAgentHealth(agentId, directory)

      if (health.halted) {
        const statusText = formatHealthStatus(health)
        await client.tui.toast.show({
          message: `AGENT HALTED: ${agentId} has SP <= 0. All actions blocked.\n${statusText}`,
          variant: 'error'
        }).catch(() => {})

        await client.app.log({
          body: {
            service: 'agent-tracker',
            level: 'error',
            message: `Agent ${agentId} is halted (SP: ${health.skill_points}). Blocking event.`,
            extra: { health }
          }
        }).catch(() => {})

        return true
      }

      if (health.pending_changes.length > 0) {
        await client.app.log({
          body: {
            service: 'agent-tracker',
            level: 'warning',
            message: `Agent ${agentId} has ${health.pending_changes.length} pending uncommitted change(s)`,
            extra: { pending: health.pending_changes }
          }
        }).catch(() => {})
      }
    } catch (_error) {
      // Health check failure must never block execution
    }

    return false
  }

  /**
   * Auto-migrates old per-project database on session start.
   */
  async function autoMigrate(): Promise<void> {
    try {
      const detection = await detectOldDatabase(directory, db)

      if (!detection.tildeExists) {
        return
      }

      if (detection.alreadyMigrated) {
        return
      }

      if (detection.hasLmdb) {
        const result = await migrateFromProjectDatabase(directory, db)

        await client.app.log({
          body: {
            service: 'agent-tracker',
            level: 'info',
            message: `Auto-migration completed: ${result.entriesMigrated} migrated, ${result.entriesSkipped} skipped`,
            extra: { sourceDir: directory, errors: result.errors }
          }
        })

        if (result.errors.length > 0) {
          await client.tui.toast.show({
            message: `Migration completed with ${result.errors.length} error(s). Check logs.`,
            variant: 'warning'
          })
        } else {
          await client.tui.toast.show({
            message: `Migrated ${result.entriesMigrated} entries from old database. Old ./~ removed.`,
            variant: 'info'
          })
        }
      } else {
        await client.tui.toast.show({
          message: 'Found ./~ directory but no agent-tracker database inside. This may have been created by something else. Please inspect and remove manually if not needed.',
          variant: 'warning'
        })

        await client.app.log({
          body: {
            service: 'agent-tracker',
            level: 'warning',
            message: 'Found ./~ directory without LMDB database — not auto-migrating',
            extra: { sourceDir: directory, tildeDir: detection.lmdbPath }
          }
        })
      }
    } catch (error) {
      await client.app.log({
        body: {
          service: 'agent-tracker',
          level: 'error',
          message: `Auto-migration failed: ${String(error)}`,
          extra: { sourceDir: directory }
        }
      }).catch(() => {})
    }
  }

  return {
    tool: {
      'migrate-agent-tracker': {
        description: 'Migrate agent tracking data from old per-project database (./~) to the centralized database. Removes the old ./~ directory after successful migration.',
        args: {},
        async execute(_args: Record<string, never>, ctx: { directory: string }) {
          const sourceDir = ctx.directory
          const result = await migrateFromProjectDatabase(sourceDir, db)

          const lines: string[] = []
          lines.push(`Migration from ${sourceDir}:`)
          lines.push(`  Entries migrated: ${result.entriesMigrated}`)
          lines.push(`  Entries skipped: ${result.entriesSkipped}`)

          if (result.errors.length > 0) {
            lines.push(`  Errors (${result.errors.length}):`)
            for (const err of result.errors) {
              lines.push(`    - ${err}`)
            }
          }

          if (result.entriesMigrated === 0 && result.entriesSkipped === 0 && result.errors.length === 0) {
            lines.push('  No old database found at this location.')
          }

          return lines.join('\n')
        }
      }
    },

    'tool.execute.before': async (input) => {
      const halted = await guardAgentHealth(input)
      if (halted) {
        throw new Error('Agent is halted (SP <= 0). All tool execution blocked. Provide a step-by-step action plan to resume.')
      }
      await envProtection.handleToolBefore(input)
    },

    'tool.execute.after': async (input: any, output: any) => {
      if (output.success) {
        await trackingService.trackToolUsage(input, output)
      }
    },

    'command.executed': async (event: any) => {
      const halted = await guardAgentHealth(event)
      if (halted) return
      if (event.success) {
        await trackingService.trackCommandCompletion(event)
      }
    },

    'session.created': async (session: any) => {
      await dependencyChecker.validate()
      await trackingService.initializeSessionTracking(session)
      await autoMigrate()
      await guardAgentHealth(session)
    },

    'session.idle': async (session: any) => {
      await guardAgentHealth(session)
      await trackingService.generateRetrospective(session)
    },

    'session.deleted': async (session: any) => {
      await trackingService.finalizeSession(session)
    },

    event: async ({ event }: { event: any }) => {
      if (event.type === 'session.created' && !db.isAvailable) {
        await client.tui.toast.show({
          message: 'Agent tracking disabled - LMDB unavailable',
          variant: 'warning'
        })
      }

      if (event.type === 'session.idle') {
        await client.tui.toast.show({
          message: 'Session completed - retrospective generated',
          variant: 'info'
        })
      }
    }
  }
}

export default AgentTrackerPlugin
