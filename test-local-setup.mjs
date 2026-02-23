#!/usr/bin/env node

// Local testing harness for OpenCode Agent Tracker plugin
// Usage: node test-local-setup.mjs

import AgentTrackerPlugin from './dist/index.js'

// Mock OpenCode client
const mockClient = {
  app: {
    log: async (logData) => {
      console.log('[LOG]', logData.body.message, logData.body.extra || '')
      return true
    }
  },
  tui: {
    toast: {
      show: async (toastData) => {
        console.log('[TOAST]', toastData.variant.toUpperCase(), '-', toastData.message)
        return true
      }
    }
  }
}

// Mock context
const mockContext = {
  project: { name: 'test-project' },
  client: mockClient,
  $: {},
  directory: '/tmp/test-project',
  worktree: '/tmp/test-project'
}

async function runTests() {
  console.log('🚀 Testing OpenCode Agent Tracker Plugin...\n')

  try {
    // Initialize plugin
    console.log('1. Initializing plugin...')
    const hooks = await AgentTrackerPlugin(mockContext)
    console.log('✅ Plugin initialized successfully\n')

    // Test .env protection
    console.log('2. Testing .env protection...')
    
    const envInput = {
      tool: 'read',
      args: { filePath: '/path/to/.env' }
    }
    const envOutput = { args: {} }
    
    try {
      await hooks['tool.execute.before'](envInput, envOutput)
      console.log('❌ .env protection failed - should have thrown error')
    } catch (error) {
      console.log('✅ .env protection working:', error.message)
    }

    // Test non-env file (should not throw)
    const safeInput = {
      tool: 'read',
      args: { filePath: '/path/to/package.json' }
    }
    try {
      await hooks['tool.execute.before'](safeInput, envOutput)
      console.log('✅ Non-env files allowed')
    } catch (error) {
      console.log('❌ Non-env file incorrectly blocked')
    }

    // Test session.created hook
    console.log('\n3. Testing session creation...')
    const sessionData = { 
      id: 'test-session-123',
      title: 'Test Session',
      agent: { id: 'test-agent' }
    }
    
    await hooks['session.created'](sessionData)
    console.log('✅ Session creation hook executed')

    // Test tool.execute.after hook
    console.log('\n4. Testing tool execution tracking...')
    const toolInput = {
      tool: 'read',
      args: { filePath: '/path/to/file.txt' },
      agentId: 'test-agent'
    }
    const toolOutput = { success: true }
    
    await hooks['tool.execute.after'](toolInput, toolOutput)
    console.log('✅ Tool execution tracking executed')

    // Test command execution
    console.log('\n5. Testing command execution tracking...')
    const commandEvent = {
      command: 'git status',
      success: true,
      agentId: 'test-agent'
    }
    
    await hooks['command.executed'](commandEvent)
    console.log('✅ Command execution tracking executed')

    // Test session.idle hook
    console.log('\n6. Testing session idle (retrospective)...')
    await hooks['session.idle'](sessionData)
    console.log('✅ Session idle hook executed')

    console.log('\n🎉 All tests completed successfully!')
    console.log('\nTo test with OpenCode:')
    console.log('1. Build the plugin: npm run build')
    console.log('2. Create symlink: ln -sf "$(pwd)/dist" ~/.config/opencode/plugins/agent-tracker')
    console.log('3. Start OpenCode and verify plugin loads')

  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

runTests()