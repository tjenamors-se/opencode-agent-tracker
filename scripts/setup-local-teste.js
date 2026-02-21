#!/usr/bin/env node

// Script to setup local testing for OpenCode Agent Tracker

import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { execSync } from 'child_process'

const OPENCODE_PLUGINS_DIR = '~/.config/opencode/plugins'
const PLUGIN_NAME = 'agent-tracker'
const PROJECT_PATH = process.cwd()

async function setupLocalTest() {
  console.log('🔧 Setting up OpenCode Agent Tracker for local testing...\n')

  try {
    // Build the plugin first
    console.log('1. Building plugin...')
    execSync('npm run build', { stdio: 'inherit' })
    console.log('✅ Plugin built successfully\n')

    // Create OpenCode plugins directory if it doesn't exist
    const pluginsDir = OPENCODE_PLUGINS_DIR.replace('~', process.env.HOME)
    
    if (!existsSync(pluginsDir)) {
      console.log('2. Creating OpenCode plugins directory...')
      await mkdir(pluginsDir, { recursive: true })
      console.log('✅ Created directory:', pluginsDir)
    } else {
      console.log('2. OpenCode plugins directory exists:', pluginsDir)
    }

    // Create symlink
    const symlinkPath = `${pluginsDir}/${PLUGIN_NAME}`
    const targetPath = `${PROJECT_PATH}/dist`
    
    console.log('3. Creating symlink...')
    console.log('   Source:', targetPath)
    console.log('   Target:', symlinkPath)
    
    try {
      execSync(`ln -sf "${targetPath}" "${symlinkPath}"`, { stdio: 'inherit' })
      console.log('✅ Symlink created successfully\n')
    } catch (error) {
      console.log('⚠️  Symlink may already exist. Checking...')
      
      if (existsSync(symlinkPath)) {
        const stats = execSync(`ls -la "${symlinkPath}"`).toString()
        console.log('📁 Current symlink status:')
        console.log(stats)
        console.log('✅ Symlink appears to be set up correctly\n')
      }
    }

    console.log('🎉 Setup complete! Next steps:')
    console.log('')
    console.log('1. Start OpenCode')
    console.log('2. The plugin should automatically load from:', symlinkPath)
    console.log('3. Test functionality by creating a new session')
    console.log('4. Verify .env file protection is working')
    console.log('')
    console.log('To remove the symlink:')
    console.log(`rm "${symlinkPath}"`)

  } catch (error) {
    console.error('❌ Setup failed:', error)
    process.exit(1)
  }
}

setupLocalTest()