import { ProjectClassifier } from '../../src/project-classifier'
import type { ProjectProfile } from '../../src/types'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('ProjectClassifier', () => {
  let classifier: ProjectClassifier
  let tmpDir: string

  beforeEach(() => {
    classifier = new ProjectClassifier()
    tmpDir = mkdtempSync(join(tmpdir(), 'pc-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('parseAgentsMd', () => {
    it('should parse table format fields', () => {
      const content = `
# Agent Definition

| Field      | Value          |
|------------|----------------|
| Name       | CMS-Backend    |
| Model      | claude-opus-4|
| Language   | PHP            |
| Framework  | Laravel        |
| Scope      | CMS            |
`
      const result = classifier.parseAgentsMd(content)
      expect(result.language).toBe('php')
      expect(result.framework).toBe('laravel')
      expect(result.scope).toBe('cms')
    })

    it('should parse key-value format fields', () => {
      const content = `
Language: TypeScript
Framework: Next.js
Scope: Frontend
`
      const result = classifier.parseAgentsMd(content)
      expect(result.language).toBe('typescript')
      expect(result.framework).toBe('next.js')
      expect(result.scope).toBe('frontend')
    })

    it('should parse bold key-value format', () => {
      const content = `
**Language**: Rust
**Framework**: Actix
**Scope**: API
`
      const result = classifier.parseAgentsMd(content)
      expect(result.language).toBe('rust')
      expect(result.framework).toBe('actix')
      expect(result.scope).toBe('api')
    })

    it('should handle mixed formats', () => {
      const content = `
| Language | Python |
Framework: Django
**Scope**: Backend
`
      const result = classifier.parseAgentsMd(content)
      expect(result.language).toBe('python')
      expect(result.framework).toBe('django')
      expect(result.scope).toBe('backend')
    })

    it('should return unknown for missing fields', () => {
      const content = `
# Some AGENTS.md with no structured fields
Just some text about the project.
`
      const result = classifier.parseAgentsMd(content)
      expect(result.language).toBe('unknown')
      expect(result.framework).toBe('unknown')
      expect(result.scope).toBe('unknown')
    })

    it('should return unknown for empty content', () => {
      const result = classifier.parseAgentsMd('')
      expect(result.language).toBe('unknown')
      expect(result.framework).toBe('unknown')
      expect(result.scope).toBe('unknown')
    })

    it('should skip table separator rows', () => {
      const content = `
| Language   | ---            |
| Framework  | Express        |
`
      const result = classifier.parseAgentsMd(content)
      expect(result.language).toBe('unknown')
      expect(result.framework).toBe('express')
    })

    it('should use first match for each field', () => {
      const content = `
Language: TypeScript
Language: JavaScript
`
      const result = classifier.parseAgentsMd(content)
      expect(result.language).toBe('typescript')
    })
  })

  describe('parseManifest', () => {
    it('should parse package.json with typescript', async () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        dependencies: { express: '^4.0.0' },
        devDependencies: { typescript: '^5.0.0', jest: '^29.0.0' }
      }))

      const result = await classifier.parseManifest(tmpDir)
      expect(result.language).toBe('typescript')
      expect(result.framework).toBe('express')
      expect(result.dependencies).toContain('express')
      expect(result.dependencies).toContain('typescript')
      expect(result.dependencies).toContain('jest')
      expect(result.manifestType).toBe('package.json')
    })

    it('should parse package.json without typescript', async () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        dependencies: { react: '^18.0.0' }
      }))

      const result = await classifier.parseManifest(tmpDir)
      expect(result.language).toBe('javascript')
      expect(result.framework).toBe('react')
    })

    it('should detect next.js framework', async () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        dependencies: { next: '^14.0.0', react: '^18.0.0' }
      }))

      const result = await classifier.parseManifest(tmpDir)
      expect(result.framework).toBe('next')
    })

    it('should parse composer.json', async () => {
      writeFileSync(join(tmpDir, 'composer.json'), JSON.stringify({
        require: { 'php': '>=8.1', 'laravel/framework': '^10.0' },
        'require-dev': { 'phpunit/phpunit': '^10.0' }
      }))

      const result = await classifier.parseManifest(tmpDir)
      expect(result.language).toBe('php')
      expect(result.framework).toBe('laravel')
      expect(result.dependencies).toContain('laravel/framework')
      expect(result.dependencies).toContain('phpunit/phpunit')
      expect(result.manifestType).toBe('composer.json')
    })

    it('should detect Cargo.toml as rust', async () => {
      writeFileSync(join(tmpDir, 'Cargo.toml'), '[package]\nname = "myapp"\n')

      const result = await classifier.parseManifest(tmpDir)
      expect(result.language).toBe('rust')
      expect(result.dependencies).toEqual([])
      expect(result.manifestType).toBe('Cargo.toml')
    })

    it('should detect go.mod as go', async () => {
      writeFileSync(join(tmpDir, 'go.mod'), 'module myapp\ngo 1.21\n')

      const result = await classifier.parseManifest(tmpDir)
      expect(result.language).toBe('go')
      expect(result.manifestType).toBe('go.mod')
    })

    it('should detect pyproject.toml as python', async () => {
      writeFileSync(join(tmpDir, 'pyproject.toml'), '[project]\nname = "myapp"\n')

      const result = await classifier.parseManifest(tmpDir)
      expect(result.language).toBe('python')
      expect(result.manifestType).toBe('pyproject.toml')
    })

    it('should detect requirements.txt as python', async () => {
      writeFileSync(join(tmpDir, 'requirements.txt'), 'flask==2.0\n')

      const result = await classifier.parseManifest(tmpDir)
      expect(result.language).toBe('python')
      expect(result.manifestType).toBe('requirements.txt')
    })

    it('should detect Gemfile as ruby', async () => {
      writeFileSync(join(tmpDir, 'Gemfile'), 'source "https://rubygems.org"\ngem "rails"\n')

      const result = await classifier.parseManifest(tmpDir)
      expect(result.language).toBe('ruby')
      expect(result.manifestType).toBe('Gemfile')
    })

    it('should prioritize package.json over composer.json', async () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ dependencies: {} }))
      writeFileSync(join(tmpDir, 'composer.json'), JSON.stringify({ require: {} }))

      const result = await classifier.parseManifest(tmpDir)
      expect(result.manifestType).toBe('package.json')
    })

    it('should return unknown when no manifest found', async () => {
      const result = await classifier.parseManifest(tmpDir)
      expect(result.language).toBe('unknown')
      expect(result.framework).toBe('unknown')
      expect(result.dependencies).toEqual([])
      expect(result.manifestType).toBe('none')
    })

    it('should handle malformed package.json gracefully', async () => {
      writeFileSync(join(tmpDir, 'package.json'), '{invalid json}')

      const result = await classifier.parseManifest(tmpDir)
      expect(result.language).toBe('javascript')
      expect(result.manifestType).toBe('package.json')
    })
  })

  describe('classifyProject', () => {
    it('should combine AGENTS.md and manifest data', async () => {
      writeFileSync(join(tmpDir, 'AGENTS.md'), `
| Field      | Value          |
|------------|----------------|
| Language   | TypeScript     |
| Framework  | Express        |
| Scope      | API            |
`)
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        dependencies: { express: '^4.0.0' },
        devDependencies: { typescript: '^5.0.0' }
      }))

      const profile = await classifier.classifyProject(tmpDir)
      expect(profile.path).toBe(tmpDir)
      expect(profile.language).toBe('typescript')
      expect(profile.framework).toBe('express')
      expect(profile.scope).toBe('api')
      expect(profile.dependencies).toContain('express')
      expect(profile.manifestType).toBe('package.json')
      expect(profile.agentsmdHash).toBeTruthy()
      expect(profile.classifiedAt).toBeTruthy()
    })

    it('should prioritize AGENTS.md fields over manifest', async () => {
      writeFileSync(join(tmpDir, 'AGENTS.md'), 'Language: Rust\nFramework: Actix\nScope: Backend\n')
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        dependencies: { next: '^14.0.0' },
        devDependencies: { typescript: '^5.0.0' }
      }))

      const profile = await classifier.classifyProject(tmpDir)
      expect(profile.language).toBe('rust')
      expect(profile.framework).toBe('actix')
      expect(profile.scope).toBe('backend')
      expect(profile.dependencies).toContain('next')
    })

    it('should fall back to manifest when AGENTS.md has no fields', async () => {
      writeFileSync(join(tmpDir, 'AGENTS.md'), '# My Project\nSome instructions.\n')
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        dependencies: { react: '^18.0.0' },
        devDependencies: { typescript: '^5.0.0' }
      }))

      const profile = await classifier.classifyProject(tmpDir)
      expect(profile.language).toBe('typescript')
      expect(profile.framework).toBe('react')
    })

    it('should handle no AGENTS.md and no manifest', async () => {
      const profile = await classifier.classifyProject(tmpDir)
      expect(profile.language).toBe('unknown')
      expect(profile.framework).toBe('unknown')
      expect(profile.scope).toBe('unknown')
      expect(profile.dependencies).toEqual([])
      expect(profile.manifestType).toBe('none')
      expect(profile.agentsmdHash).toBe('')
    })

    it('should produce consistent hash for same AGENTS.md content', async () => {
      const content = 'Language: TypeScript\nScope: Plugin\n'
      writeFileSync(join(tmpDir, 'AGENTS.md'), content)

      const profile1 = await classifier.classifyProject(tmpDir)

      const tmpDir2 = mkdtempSync(join(tmpdir(), 'pc-test2-'))
      writeFileSync(join(tmpDir2, 'AGENTS.md'), content)

      const profile2 = await classifier.classifyProject(tmpDir2)
      rmSync(tmpDir2, { recursive: true, force: true })

      expect(profile1.agentsmdHash).toBe(profile2.agentsmdHash)
    })
  })

  describe('scoreSimilarity', () => {
    const baseProfile: ProjectProfile = {
      path: '/a',
      language: 'typescript',
      framework: 'express',
      scope: 'api',
      dependencies: ['express', 'typescript', 'jest'],
      manifestType: 'package.json',
      classifiedAt: '2026-02-23T10:00:00.000Z',
      agentsmdHash: 'abc'
    }

    it('should return 1.0 for identical profiles', () => {
      const score = classifier.scoreSimilarity(baseProfile, { ...baseProfile, path: '/b' })
      expect(score).toBe(1.0)
    })

    it('should return 0.4 for same language only', () => {
      const other: ProjectProfile = {
        ...baseProfile,
        path: '/b',
        framework: 'fastify',
        scope: 'cms',
        dependencies: ['fastify']
      }
      const score = classifier.scoreSimilarity(baseProfile, other)
      expect(score).toBe(0.4)
    })

    it('should return 0 for completely different profiles', () => {
      const other: ProjectProfile = {
        ...baseProfile,
        path: '/b',
        language: 'php',
        framework: 'laravel',
        scope: 'cms',
        dependencies: ['laravel/framework']
      }
      const score = classifier.scoreSimilarity(baseProfile, other)
      expect(score).toBe(0)
    })

    it('should score partial dependency overlap', () => {
      const other: ProjectProfile = {
        ...baseProfile,
        path: '/b',
        dependencies: ['express', 'typescript', 'mocha', 'supertest']
      }
      // Same lang (+0.4), same framework (+0.3), same scope (+0.2)
      // Deps: 2 shared out of max(3, 4) = 4 -> 0.1 * 0.5 = 0.05
      const score = classifier.scoreSimilarity(baseProfile, other)
      expect(score).toBe(0.95)
    })

    it('should not match unknown fields', () => {
      const a: ProjectProfile = { ...baseProfile, language: 'unknown', framework: 'unknown', scope: 'unknown', dependencies: [] }
      const b: ProjectProfile = { ...baseProfile, path: '/b', language: 'unknown', framework: 'unknown', scope: 'unknown', dependencies: [] }
      const score = classifier.scoreSimilarity(a, b)
      expect(score).toBe(0)
    })

    it('should handle empty dependencies on both sides', () => {
      const a: ProjectProfile = { ...baseProfile, dependencies: [] }
      const b: ProjectProfile = { ...baseProfile, path: '/b', dependencies: [] }
      // lang + framework + scope = 0.4 + 0.3 + 0.2 = 0.9, no dep bonus
      const score = classifier.scoreSimilarity(a, b)
      expect(score).toBe(0.9)
    })
  })

  describe('hashContent', () => {
    it('should return a 16-char hex string', () => {
      const hash = classifier.hashContent('hello world')
      expect(hash).toMatch(/^[a-f0-9]{16}$/)
    })

    it('should return different hashes for different content', () => {
      const hash1 = classifier.hashContent('content A')
      const hash2 = classifier.hashContent('content B')
      expect(hash1).not.toBe(hash2)
    })

    it('should return same hash for same content', () => {
      const hash1 = classifier.hashContent('identical')
      const hash2 = classifier.hashContent('identical')
      expect(hash1).toBe(hash2)
    })
  })
})
