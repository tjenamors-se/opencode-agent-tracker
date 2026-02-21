import type { Plugin } from '@opencode-ai/plugin'
import { LMDBDatabase } from './lmdb-database.js'
import { TrackingService } from './tracking-service.js'
import { DependencyChecker } from './dependency-checker.js'
import { EnvProtection } from './env-protection.js'

export const AgentTrackerPlugin: Plugin = async (context: any) => {
  const { project, client, directory } = context
  // Initialize database
  const db = new LMDBDatabase()
  
  // Check dependencies at session creation
  const dependencyChecker = new DependencyChecker(client)
  
  // Create tracking service
  const trackingService = new TrackingService(db, client)
  
  // Initialize environment protection
  const envProtection = new EnvProtection()
  
  // Log plugin initialization
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
    // Environment protection hooks
    'tool.execute.before': async (input) => {
      await envProtection.handleToolBefore(input)
    },
    
    // Tracking hooks
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

    // Event handler for notifications
    event: async ({ event }: { event: any }) => {
      // Show notification when LMDB is unavailable
      if (event.type === 'session.created' && !db.isAvailable) {
        await client.tui.toast.show({
          message: 'Agent tracking disabled - LMDB unavailable',
          variant: 'warning'
        })
      }
      
      // Show notification on session completion with retrospective
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