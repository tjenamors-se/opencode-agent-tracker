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