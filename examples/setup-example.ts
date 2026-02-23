// Example: Basic Plugin Setup
// This file demonstrates how to use the OpenCode Agent Tracker plugin

import type { PluginConfig } from '../src/types.js'
import type { AgentData } from '../src/types.js'

// Plugin configuration example matching actual PluginConfig interface
const config: PluginConfig = {
  databasePath: '~/.config/opencode/agent-tracker.lmdb',
  enableGitHooks: true,
  enableNotifications: true,
  enableEnvironmentProtection: true
}

// Example plugin registration - matches actual plugin structure
// Note: Plugin auto-registers when installed in OpenCode plugins directory
const pluginConfig = {
  name: 'agent-tracker',
  version: '0.0.0-alpha-dev',
  config
}

// Example usage in OpenCode configuration
const opencodeConfig = {
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "@tjenamors.se/opencode-agent-tracker"
  ],
  "agent-tracker": config
}

// Agent data example matching AgentData interface
const sampleAgentData: AgentData = {
  id: 'test-agent-1',
  name: 'CMS-Backend',
  model: 'deepseek-v3.1:671b',
  scope: 'CMS',
  skill_points: 1,
  experience_points: 0,
  communication_score: 60,
  total_commits: 0,
  total_bugs: 0,
  active: true,
  created_at: new Date(),
  updated_at: new Date()
}

// Custom tool usage example - showing how hooks work
const customToolHandler = {
  description: "Example tool that integrates with agent tracking",
  execute: async (args: { tool: string; filePath?: string }) => {
    // Agent tracker automatically hooks into tool execution
    // via 'tool.execute.before' and 'tool.execute.after' events
    console.log(`Executing tool: ${args.tool}`)
    
    if (args.filePath) {
      // .env protection will automatically validate file access
      console.log(`Accessing file: ${args.filePath}`)
    }
    
    return { success: true, output: 'Tool completed' }
  }
}

// Performance benchmark example
async function benchmarkTracking(): Promise<void> {
  const iterations = 1000
  const startTime = Date.now()
  
  // Simulated tracking calls
  for (let i = 0; i < iterations; i++) {
    // Simulate tracking event - actual tracking happens via hooks
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  
  const duration = Date.now() - startTime
  const opsPerSecond = (iterations / duration) * 1000
  
  console.log(`Performance simulation: ${opsPerSecond.toFixed(0)} operations/second`)
}

// Error handling example
async function simulateTrackingOperation(): Promise<{ status: string; error?: string }> {
  try {
    // Simulate tracking operation
    console.log('Tracking operation started')
    
    // In case of LMDB unavailability, plugin gracefully degrades
    return { status: 'tracking_completed' }
  } catch (error) {
    // Graceful degradation - track locally without LMDB
    console.warn('LMDB unavailable, tracking disabled:', error instanceof Error ? error.message : 'Unknown error')
    return { status: 'tracking_disabled', error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Integration with git hooks example
const gitHookIntegration = {
  preCommit: async (commitData: { agentId: string; projectPath: string }): Promise<boolean> => {
    // Plugin validates agent registration when enableGitHooks is true
    console.log(`Validating agent ${commitData.agentId} for commit`)
    return true
  },
  
  postCommit: async (commitData: { agentId: string; commitHash: string; projectPath: string; taskDescription: string }): Promise<void> => {
    // Plugin automatically tracks commits when enableGitHooks is true
    console.log(`Tracking commit ${commitData.commitHash} from agent ${commitData.agentId}`)
  }
}

// Example showing plugin loading pattern
const pluginInitialization = {
  async initialize(context: any): Promise<void> {
    const { project, client, directory } = context
    
    // Plugin automatically initializes when OpenCode loads it
    console.log(`Agent tracker initialized for project: ${project?.name || 'unknown'}`)
    
    if (config.enableNotifications) {
      await client.tui.toast.show({
        message: 'Agent tracker plugin activated',
        variant: 'info'
      })
    }
  }
}

export {
  config,
  pluginConfig,
  opencodeConfig,
  sampleAgentData,
  customToolHandler,
  benchmarkTracking,
  simulateTrackingOperation,
  gitHookIntegration,
  pluginInitialization
}