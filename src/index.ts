import type { Plugin } from '@opencode-ai/plugin'
import { LMDBDatabase } from './lmdb-database.js'
import { TrackingService } from './tracking-service.js'
import { WriteBuffer } from './write-buffer.js'
import { DependencyChecker } from './dependency-checker.js'
import { EnvProtection } from './env-protection.js'
import type { PluginConfig, DatabaseConfig } from './types.js'

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

  return {
    'tool.execute.before': async (input) => {
      await envProtection.handleToolBefore(input)
    },

    'tool.execute.after': async (input: any, output: any) => {
      if (output.success) {
        await trackingService.trackToolUsage(input, output)
      }
    },

    'command.executed': async (event: any) => {
      if (event.success) {
        await trackingService.trackCommandCompletion(event)
      }
    },

    'session.created': async (session: any) => {
      await dependencyChecker.validate()
      await trackingService.initializeSessionTracking(session)
    },

    'session.idle': async (session: any) => {
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
