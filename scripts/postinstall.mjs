#!/usr/bin/env node

/**
 * @tjenamors.se/opencode-agent-tracker postinstall script
 *
 * Installs plugin, skills, agent definitions, and scoring system
 * into ~/.config/opencode/ after npm install.
 *
 * All operations are independent and fail gracefully (exit 0 always).
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PACKAGE_ROOT = join(__dirname, '..')
const CONFIG_DIR = join(homedir(), '.config', 'opencode')

const SENTINEL_START = '<!-- agent-tracker-scoring-start -->'
const SENTINEL_END = '<!-- agent-tracker-scoring-end -->'

/**
 * R9.6: Detect non-interactive environments.
 */
function isNonInteractive() {
  return !!(process.env.CI || process.env.NONINTERACTIVE || !process.stdin.isTTY)
}

/**
 * R9.1: Copy plugin dist/ to ~/.config/opencode/plugins/agent-tracker/
 * Always overwrites (latest version wins).
 */
function copyPlugin() {
  const src = join(PACKAGE_ROOT, 'dist')
  const dst = join(CONFIG_DIR, 'plugins', 'agent-tracker')

  if (!existsSync(src)) {
    console.error('[agent-tracker] [error] dist/ directory not found in package. Skipping plugin copy.')
    return
  }

  try {
    mkdirSync(dst, { recursive: true })
    cpSync(src, dst, { recursive: true, force: true })
    console.log('[agent-tracker] [install] Plugin copied to', dst)
  } catch (err) {
    console.error('[agent-tracker] [error] Failed to copy plugin:', err.message)
  }
}

/**
 * R9.2: Copy skills to ~/.config/opencode/skills/
 * Skips if skill directory already exists.
 */
function installSkills() {
  const skillsSrc = join(PACKAGE_ROOT, 'skills')
  const skillsDst = join(CONFIG_DIR, 'skills')

  if (!existsSync(skillsSrc)) {
    console.error('[agent-tracker] [error] skills/ directory not found in package. Skipping skills install.')
    return
  }

  try {
    const skills = readdirSync(skillsSrc)
    for (const skill of skills) {
      const srcDir = join(skillsSrc, skill)
      const dstDir = join(skillsDst, skill)

      if (existsSync(dstDir)) {
        console.log('[agent-tracker] [skip] Skill', skill, 'already exists at', dstDir)
        continue
      }

      try {
        mkdirSync(dstDir, { recursive: true })
        cpSync(srcDir, dstDir, { recursive: true })
        console.log('[agent-tracker] [install] Skill', skill, 'installed to', dstDir)
      } catch (err) {
        console.error('[agent-tracker] [error] Failed to install skill', skill + ':', err.message)
      }
    }
  } catch (err) {
    console.error('[agent-tracker] [error] Failed to read skills directory:', err.message)
  }
}

/**
 * R9.3 + R9.4: Install agent definitions and register plugin in opencode.json.
 * Skips agents that already exist. Adds plugin if not present.
 * Removes stale file:// dev paths.
 */
function installAgents() {
  const agentsFile = join(PACKAGE_ROOT, 'agents', 'agents.json')
  const configFile = join(CONFIG_DIR, 'opencode.json')
  const pluginPath = join(CONFIG_DIR, 'plugins', 'agent-tracker')

  if (!existsSync(agentsFile)) {
    console.error('[agent-tracker] [error] agents/agents.json not found in package. Skipping agent install.')
    return
  }

  try {
    const bundledAgents = JSON.parse(readFileSync(agentsFile, 'utf-8'))

    // Read or create opencode.json
    let config = {}
    if (existsSync(configFile)) {
      try {
        config = JSON.parse(readFileSync(configFile, 'utf-8'))
      } catch (parseErr) {
        console.error('[agent-tracker] [error] opencode.json is malformed JSON. Cannot merge agents.')
        console.error('[agent-tracker] [error] Please fix', configFile, 'manually and re-run npm install.')
        return
      }
    } else {
      mkdirSync(CONFIG_DIR, { recursive: true })
    }

    // R9.3: Merge agent definitions
    if (!config.agent) {
      config.agent = {}
    }

    for (const [name, definition] of Object.entries(bundledAgents)) {
      if (config.agent[name]) {
        console.log('[agent-tracker] [skip] Agent', name, 'already exists in opencode.json')
      } else {
        config.agent[name] = definition
        console.log('[agent-tracker] [install] Agent', name, 'added to opencode.json')
      }
    }

    // R9.4: Register plugin
    if (!Array.isArray(config.plugin)) {
      config.plugin = []
    }

    // Remove stale file:// dev paths pointing to this plugin
    const originalLength = config.plugin.length
    config.plugin = config.plugin.filter(p => {
      if (typeof p === 'string' && p.includes('opencode-agent-tracker') && p.startsWith('file://')) {
        console.log('[agent-tracker] [remove] Stale dev path removed:', p)
        return false
      }
      return true
    })

    // Add plugin path if not already present
    const alreadyRegistered = config.plugin.some(
      p => typeof p === 'string' && p.includes('plugins/agent-tracker')
    )

    if (!alreadyRegistered) {
      config.plugin.push(pluginPath)
      console.log('[agent-tracker] [install] Plugin registered in opencode.json:', pluginPath)
    } else {
      console.log('[agent-tracker] [skip] Plugin already registered in opencode.json')
    }

    // Write back
    writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    console.log('[agent-tracker] [done] opencode.json updated at', configFile)
  } catch (err) {
    console.error('[agent-tracker] [error] Failed to install agents:', err.message)
  }
}

/**
 * R9.5: Create or merge AGENTS.md scoring system.
 * If AGENTS.md exists and has no sentinel, append scoring section.
 * If AGENTS.md exists and has sentinel, skip.
 * If AGENTS.md does not exist, create from TRACK_AGENTS.md.
 */
function installAgentsMd() {
  const trackFile = join(PACKAGE_ROOT, 'agents', 'TRACK_AGENTS.md')
  const agentsMdFile = join(CONFIG_DIR, 'AGENTS.md')

  if (!existsSync(trackFile)) {
    console.error('[agent-tracker] [error] agents/TRACK_AGENTS.md not found in package. Skipping AGENTS.md install.')
    return
  }

  try {
    const scoringContent = readFileSync(trackFile, 'utf-8')

    if (existsSync(agentsMdFile)) {
      const existing = readFileSync(agentsMdFile, 'utf-8')

      if (existing.includes(SENTINEL_START)) {
        console.log('[agent-tracker] [skip] AGENTS.md already contains scoring system')
        return
      }

      // Merge: append scoring section to existing AGENTS.md
      const merged = existing.trimEnd() + '\n\n' + scoringContent
      writeFileSync(agentsMdFile, merged, 'utf-8')
      console.log('[agent-tracker] [merge] Scoring system appended to existing AGENTS.md')
    } else {
      // Create new AGENTS.md from TRACK_AGENTS.md content
      mkdirSync(CONFIG_DIR, { recursive: true })
      writeFileSync(agentsMdFile, scoringContent, 'utf-8')
      console.log('[agent-tracker] [create] AGENTS.md created at', agentsMdFile)
    }
  } catch (err) {
    console.error('[agent-tracker] [error] Failed to install AGENTS.md:', err.message)
  }
}

/**
 * Main orchestrator. Runs all operations independently.
 * Never throws, always exits 0.
 */
async function main() {
  console.log('[agent-tracker] Starting postinstall setup...')

  if (isNonInteractive()) {
    console.log('[agent-tracker] Non-interactive mode detected. Using safe defaults.')
  }

  copyPlugin()
  installSkills()
  installAgents()
  installAgentsMd()

  console.log('[agent-tracker] Postinstall complete.')
}

main().catch(err => {
  console.error('[agent-tracker] [error] Unexpected error:', err.message)
  process.exit(0) // Never fail npm install
})
