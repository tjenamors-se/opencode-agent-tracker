import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import type { ProjectProfile } from './types.js'

const FRAMEWORK_INDICATORS: Record<string, string[]> = {
  'next': ['next'],
  'express': ['express'],
  'react': ['react'],
  'vue': ['vue'],
  'angular': ['@angular/core'],
  'svelte': ['svelte'],
  'nestjs': ['@nestjs/core'],
  'fastify': ['fastify'],
  'hono': ['hono'],
  'laravel': ['laravel/framework'],
  'symfony': ['symfony/framework-bundle', 'symfony/symfony'],
  'wordpress': ['wordpress', 'wp-cli'],
}

const AGENTS_MD_FIELDS = ['language', 'framework', 'scope']

/**
 * Classifies projects by parsing AGENTS.md and manifest files.
 * Used for cross-project learning and similarity scoring.
 */
export class ProjectClassifier {

  /**
   * Classifies a project by reading its AGENTS.md and manifest files.
   * AGENTS.md fields take priority over manifest-inferred fields.
   */
  async classifyProject(projectPath: string): Promise<ProjectProfile> {
    const agentsMdPath = join(projectPath, 'AGENTS.md')
    let agentsMdFields = { language: 'unknown', framework: 'unknown', scope: 'unknown' }
    let agentsmdHash = ''

    if (existsSync(agentsMdPath)) {
      try {
        const content = readFileSync(agentsMdPath, 'utf-8')
        agentsMdFields = this.parseAgentsMd(content)
        agentsmdHash = this.hashContent(content)
      } catch (_error) {
        // Best-effort: continue with defaults
      }
    }

    const manifest = await this.parseManifest(projectPath)

    return {
      path: projectPath,
      language: agentsMdFields.language !== 'unknown' ? agentsMdFields.language : manifest.language,
      framework: agentsMdFields.framework !== 'unknown' ? agentsMdFields.framework : manifest.framework,
      scope: agentsMdFields.scope,
      dependencies: manifest.dependencies,
      manifestType: manifest.manifestType,
      classifiedAt: new Date().toISOString(),
      agentsmdHash
    }
  }

  /**
   * Parses AGENTS.md content for Language, Framework, and Scope fields.
   * Handles table format (| Field | Value |) and key-value format (Field: Value).
   */
  parseAgentsMd(content: string): { language: string; framework: string; scope: string } {
    const fields: Record<string, string> = {}

    for (const line of content.split('\n')) {
      const trimmed = line.trim()

      for (const field of AGENTS_MD_FIELDS) {
        if (fields[field]) continue

        const tableMatch = trimmed.match(
          new RegExp(`^\\|?\\s*${field}\\s*\\|\\s*(.+?)\\s*\\|?$`, 'i')
        )
        if (tableMatch?.[1]) {
          const value = tableMatch[1].trim()
          if (value && value !== '---' && !value.match(/^-+$/)) {
            fields[field] = value.toLowerCase()
            continue
          }
        }

        const kvMatch = trimmed.match(
          new RegExp(`^\\*{0,2}${field}\\*{0,2}\\s*[:=]\\s*(.+)$`, 'i')
        )
        if (kvMatch?.[1]) {
          fields[field] = kvMatch[1].trim().toLowerCase()
        }
      }
    }

    return {
      language: fields['language'] ?? 'unknown',
      framework: fields['framework'] ?? 'unknown',
      scope: fields['scope'] ?? 'unknown'
    }
  }

  /**
   * Parses manifest files in priority order to determine language,
   * framework, and dependencies.
   */
  async parseManifest(projectPath: string): Promise<{
    language: string
    framework: string
    dependencies: string[]
    manifestType: string
  }> {
    const packageJsonPath = join(projectPath, 'package.json')
    if (existsSync(packageJsonPath)) {
      return this.parsePackageJson(packageJsonPath)
    }

    const composerJsonPath = join(projectPath, 'composer.json')
    if (existsSync(composerJsonPath)) {
      return this.parseComposerJson(composerJsonPath)
    }

    const detectionManifests: Array<{ file: string; language: string; manifestType: string }> = [
      { file: 'Cargo.toml', language: 'rust', manifestType: 'Cargo.toml' },
      { file: 'go.mod', language: 'go', manifestType: 'go.mod' },
      { file: 'pyproject.toml', language: 'python', manifestType: 'pyproject.toml' },
      { file: 'requirements.txt', language: 'python', manifestType: 'requirements.txt' },
      { file: 'pom.xml', language: 'java', manifestType: 'pom.xml' },
      { file: 'build.gradle', language: 'java', manifestType: 'build.gradle' },
      { file: 'Gemfile', language: 'ruby', manifestType: 'Gemfile' },
    ]

    for (const entry of detectionManifests) {
      if (existsSync(join(projectPath, entry.file))) {
        return {
          language: entry.language,
          framework: 'unknown',
          dependencies: [],
          manifestType: entry.manifestType
        }
      }
    }

    return { language: 'unknown', framework: 'unknown', dependencies: [], manifestType: 'none' }
  }

  /**
   * Scores similarity between two project profiles.
   * Returns 0.0 to 1.0 based on weighted field comparison.
   */
  scoreSimilarity(a: ProjectProfile, b: ProjectProfile): number {
    let score = 0

    if (a.language !== 'unknown' && b.language !== 'unknown' && a.language === b.language) {
      score += 0.4
    }

    if (a.framework !== 'unknown' && b.framework !== 'unknown' && a.framework === b.framework) {
      score += 0.3
    }

    if (a.scope !== 'unknown' && b.scope !== 'unknown' && a.scope === b.scope) {
      score += 0.2
    }

    const maxDeps = Math.max(a.dependencies.length, b.dependencies.length)
    if (maxDeps > 0) {
      const setB = new Set(b.dependencies)
      let shared = 0
      for (const dep of a.dependencies) {
        if (setB.has(dep)) shared++
      }
      score += 0.1 * (shared / maxDeps)
    }

    return Math.round(score * 100) / 100
  }

  /**
   * Hashes content using SHA-256, returns first 16 hex chars.
   */
  hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').substring(0, 16)
  }

  /**
   * Parses package.json to extract language, framework, and dependencies.
   */
  private parsePackageJson(filePath: string): {
    language: string
    framework: string
    dependencies: string[]
    manifestType: string
  } {
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const pkg = JSON.parse(raw) as Record<string, unknown>

      const deps: string[] = []
      const depsObj = pkg['dependencies'] as Record<string, string> | undefined
      const devDepsObj = pkg['devDependencies'] as Record<string, string> | undefined

      if (depsObj && typeof depsObj === 'object') {
        deps.push(...Object.keys(depsObj))
      }
      if (devDepsObj && typeof devDepsObj === 'object') {
        deps.push(...Object.keys(devDepsObj))
      }

      const language = deps.includes('typescript') ? 'typescript' : 'javascript'
      const framework = this.detectFramework(deps)

      return { language, framework, dependencies: deps, manifestType: 'package.json' }
    } catch (_error) {
      return { language: 'javascript', framework: 'unknown', dependencies: [], manifestType: 'package.json' }
    }
  }

  /**
   * Parses composer.json to extract language, framework, and dependencies.
   */
  private parseComposerJson(filePath: string): {
    language: string
    framework: string
    dependencies: string[]
    manifestType: string
  } {
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const composer = JSON.parse(raw) as Record<string, unknown>

      const deps: string[] = []
      const requireObj = composer['require'] as Record<string, string> | undefined
      const requireDevObj = composer['require-dev'] as Record<string, string> | undefined

      if (requireObj && typeof requireObj === 'object') {
        deps.push(...Object.keys(requireObj))
      }
      if (requireDevObj && typeof requireDevObj === 'object') {
        deps.push(...Object.keys(requireDevObj))
      }

      const framework = this.detectFramework(deps)

      return { language: 'php', framework, dependencies: deps, manifestType: 'composer.json' }
    } catch (_error) {
      return { language: 'php', framework: 'unknown', dependencies: [], manifestType: 'composer.json' }
    }
  }

  /**
   * Detects framework from dependency list using known indicators.
   */
  private detectFramework(deps: string[]): string {
    const depSet = new Set(deps)
    for (const [framework, indicators] of Object.entries(FRAMEWORK_INDICATORS)) {
      for (const indicator of indicators) {
        if (depSet.has(indicator)) {
          return framework
        }
      }
    }
    return 'unknown'
  }
}
