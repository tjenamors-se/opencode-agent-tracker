// Example: Basic Plugin Setup
// This file demonstrates how to use the OpenCode Agent Tracker plugin

import { AgentTrackerPlugin } from '@tjenamors.se/opencode-agent-tracker'

// Plugin configuration example
const config = {
  // Database configuration
  database: {
    path: '~/.config/opencode/agent-tracker.lmdb',
    compression: true,
    cacheSize: '2GB'
  },
  
  // Tracking configuration
  tracking: {
    xpThreshold: 100,           // XP needed for SP level-up
    enableGitHooks: true,       // Integrate with git hooks
    communicationScoring: true, // Track communication quality
    journalTracking: true       // Maintain activity journal
  }
}

// Example usage in OpenCode configuration
const opencodeConfig = {
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "@tjenamors.se/opencode-agent-tracker"
  ],
  "agent-tracker": {
    "databasePath": "~/.config/opencode/tracking.lmdb",
    "xpThreshold": 100,
    "enableGitHooks": true
  }
}

// Custom tool usage example
const agentStatusTool = {
  description: "Get current agent tracking status",
  execute: async (args) => {
    // Plugin provides agent_status tool
    const status = await agentTracker.agent_status({
      agent: args.agent || 'current'
    })
    return status
  }
}

// Performance benchmark example
async function benchmarkTracking() {
  const iterations = 1000
  const startTime = Date.now()
  
  for (let i = 0; i < iterations; i++) {
    await agentTracker.trackToolUsage({
      agentId: 'test-agent',
      tool: 'read',
      success: true
    })
  }
  
  const duration = Date.now() - startTime
  const opsPerSecond = (iterations / duration) * 1000
  
  console.log(`Performance: ${opsPerSecond.toFixed(0)} operations/second`)
}

// Error handling example
async function safeTrackingOperation() {
  try {
    const result = await agentTracker.trackCommit({
      agentId: 'current-agent',
      commitHash: 'abc123',
      projectPath: '/path/to/project'
    })
    return result
  } catch (error) {
    // Graceful degradation - track locally without LMDB
    console.warn('LMDB unavailable, tracking disabled:', error.message)
    return { status: 'tracking_disabled', error: error.message }
  }
}

// Integration with git hooks example
const gitHookHandler = {
  preCommit: async () => {
    const agentValid = await agentTracker.validateAgentForCommit()
    if (!agentValid) {
      throw new Error('Agent not registered for tracking')
    }
    return true
  },
  
  postCommit: async (commitData) => {
    await agentTracker.trackCommit({
      agentId: commitData.agentId,
      commitHash: commitData.hash,
      projectPath: commitData.projectPath,
      taskDescription: commitData.message
    })
  }
}

export {
  config,
  opencodeConfig,
  agentStatusTool,
  benchmarkTracking,
  safeTrackingOperation,
  gitHookHandler
}