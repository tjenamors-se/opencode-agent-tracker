import { EnvProtection } from '../../src/env-protection.js'

describe('EnvProtection', () => {
  let envProtection: EnvProtection

  beforeEach(() => {
    envProtection = new EnvProtection()
  })

  describe('handleToolBefore', () => {
    it('should block reading .env files', async () => {
      const input = {
        tool: 'read',
        args: { filePath: '/path/to/.env' }
      }
      const output = { args: {} }

      await expect(envProtection.handleToolBefore(input, output))
        .rejects.toThrow('Do not read .env files')
    })

    it('should block writing .env files', async () => {
      const input = {
        tool: 'write',
        args: { filePath: '/path/to/.env' }
      }
      const output = { args: {} }

      await expect(envProtection.handleToolBefore(input, output))
        .rejects.toThrow('Do not write .env files')
    })

    it('should block editing .env files', async () => {
      const input = {
        tool: 'edit',
        args: { filePath: '/path/to/.env' }
      }
      const output = { args: {} }

      await expect(envProtection.handleToolBefore(input, output))
        .rejects.toThrow('Do not edit .env files')
    })

    it('should block .env.local files', async () => {
      const input = {
        tool: 'read',
        args: { filePath: '/path/to/.env.local' }
      }
      const output = { args: {} }

      await expect(envProtection.handleToolBefore(input, output))
        .rejects.toThrow('Do not read .env files')
    })

    it('should block .env.development files', async () => {
      const input = {
        tool: 'read',
        args: { filePath: '/path/to/.env.development' }
      }
      const output = { args: {} }

      await expect(envProtection.handleToolBefore(input, output))
        .rejects.toThrow('Do not read .env files')
    })

    it('should allow non-env files', async () => {
      const input = {
        tool: 'read',
        args: { filePath: '/path/to/package.json' }
      }
      const output = { args: {} }

      await expect(envProtection.handleToolBefore(input, output))
        .resolves.not.toThrow()
    })

    it('should allow files without .env extension', async () => {
      const input = {
        tool: 'read',
        args: { filePath: '/path/to/README.md' }
      }
      const output = { args: {} }

      await expect(envProtection.handleToolBefore(input, output))
        .resolves.not.toThrow()
    })
  })

  describe('isEnvFile', () => {
    it('should recognize .env files', () => {
      expect(envProtection['isEnvFile']('/path/to/.env')).toBe(true)
      expect(envProtection['isEnvFile']('.env')).toBe(true)
    })

    it('should recognize .env.local files', () => {
      expect(envProtection['isEnvFile']('/path/to/.env.local')).toBe(true)
    })

    it('should recognize .env.development files', () => {
      expect(envProtection['isEnvFile']('/path/to/.env.development')).toBe(true)
    })

    it('should recognize .env.production files', () => {
      expect(envProtection['isEnvFile']('/path/to/.env.production')).toBe(true)
    })

    it('should recognize .env.test files', () => {
      expect(envProtection['isEnvFile']('/path/to/.env.test')).toBe(true)
    })

    it('should reject non-env files', () => {
      expect(envProtection['isEnvFile']('/path/to/package.json')).toBe(false)
      expect(envProtection['isEnvFile']('/path/to/index.ts')).toBe(false)
      expect(envProtection['isEnvFile']('/path/to/README.md')).toBe(false)
    })

    it('should reject empty paths', () => {
      expect(envProtection['isEnvFile']('')).toBe(false)
      expect(envProtection['isEnvFile'](null as any)).toBe(false)
      expect(envProtection['isEnvFile'](undefined as any)).toBe(false)
    })
  })
})