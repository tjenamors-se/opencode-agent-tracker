import { EnvProtection } from '../../src/env-protection';

describe('EnvProtection', () => {
  let envProtection;

  beforeEach(() => {
    envProtection = new EnvProtection();
  });

  it('should block reading .env files', async () => {
    const input = {
      tool: 'read',
      args: { filePath: '/path/to/.env' }
    };

    await expect(envProtection.handleToolBefore(input))
      .rejects.toThrow('Do not read .env files');
  });

  it('should allow non-env files', async () => {
    const input = {
      tool: 'read',
      args: { filePath: '/path/to/package.json' }
    };

    await expect(envProtection.handleToolBefore(input))
      .resolves.not.toThrow();
  });

  it('should detect .env files', () => {
    expect(envProtection['isEnvFile']('/path/to/.env')).toBe(true);
    expect(envProtection['isEnvFile']('/path/to/.env.local')).toBe(true);
    expect(envProtection['isEnvFile']('/path/to/.env.production')).toBe(true);
    expect(envProtection['isEnvFile']('/path/to/package.json')).toBe(false);
  });
});
describe('EnvProtection - write and edit tools', () => {
  let envProtection: any;

  beforeEach(async () => {
    const { EnvProtection } = await import('../../src/env-protection');
    envProtection = new EnvProtection();
  });

  it('should block writing .env files', async () => {
    const input = { tool: 'write', args: { filePath: '/path/.env' } };
    await expect(envProtection.handleToolBefore(input)).rejects.toThrow('Do not write .env files');
  });

  it('should block editing .env files', async () => {
    const input = { tool: 'edit', args: { filePath: '/path/.env' } };
    await expect(envProtection.handleToolBefore(input)).rejects.toThrow('Do not edit .env files');
  });

  it('should allow writing non-env files', async () => {
    const input = { tool: 'write', args: { filePath: '/path/config.json' } };
    await expect(envProtection.handleToolBefore(input)).resolves.not.toThrow();
  });

  it('should allow editing non-env files', async () => {
    const input = { tool: 'edit', args: { filePath: '/path/config.json' } };
    await expect(envProtection.handleToolBefore(input)).resolves.not.toThrow();
  });
});
