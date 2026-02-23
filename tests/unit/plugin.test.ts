import AgentTrackerPlugin from '../../src/index';
import type { Plugin } from '@opencode-ai/plugin';

describe('AgentTrackerPlugin', () => {
  const makeMockContext = (overrides: Record<string, any> = {}) => ({
    project: { name: 'test-project' },
    client: {
      app: {
        log: jest.fn().mockResolvedValue(true)
      },
      tui: {
        toast: {
          show: jest.fn().mockResolvedValue(true)
        }
      }
    },
    directory: '/test/directory',
    $: {},
    ...overrides
  });

  it('should initialize plugin successfully', async () => {
    const ctx = makeMockContext();
    const plugin: Plugin = await AgentTrackerPlugin(ctx as any);

    expect(typeof plugin).toBe('object');
    expect(plugin['tool.execute.before']).toBeDefined();
    expect(plugin['tool.execute.after']).toBeDefined();
    expect(plugin['command.executed']).toBeDefined();
    expect(plugin['session.created']).toBeDefined();
    expect(plugin['session.idle']).toBeDefined();
    expect(plugin['session.deleted']).toBeDefined();
    expect(plugin['event']).toBeDefined();
  });

  it('should pass plugin config to database', async () => {
    const ctx = makeMockContext({
      $: {
        databasePath: '/tmp/test-tracker.lmdb',
        maxDatabaseSize: 1024 * 1024 * 100
      }
    });

    const plugin: Plugin = await AgentTrackerPlugin(ctx as any);
    expect(typeof plugin).toBe('object');
    expect(ctx.client.app.log).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          message: 'Agent tracker plugin initialized'
        })
      })
    );
  });

  it('should use defaults when no config provided', async () => {
    const ctx = makeMockContext({ $: undefined });
    const plugin: Plugin = await AgentTrackerPlugin(ctx as any);
    expect(typeof plugin).toBe('object');
  });

  it('should handle tool execution hooks', async () => {
    const ctx = makeMockContext();
    const plugin: Plugin = await AgentTrackerPlugin(ctx as any);

    const beforeHook = plugin['tool.execute.before'];
    expect(typeof beforeHook).toBe('function');

    const normalInput = {
      tool: 'read',
      args: { filePath: '/path/to/package.json' }
    };
    await expect(beforeHook(normalInput)).resolves.not.toThrow();

    const envInput = {
      tool: 'read',
      args: { filePath: '/path/to/.env' }
    };
    await expect(beforeHook(envInput)).rejects.toThrow('Do not read .env files');

    const afterHook = plugin['tool.execute.after'];
    expect(typeof afterHook).toBe('function');

    const successInput = { agentId: 'test-agent', tool: 'read' };
    const successOutput = { success: true };
    await expect(afterHook(successInput, successOutput)).resolves.not.toThrow();

    const failOutput = { success: false };
    await expect(afterHook(successInput, failOutput)).resolves.not.toThrow();
  });

  it('should handle session hooks', async () => {
    const ctx = makeMockContext();
    const plugin: Plugin = await AgentTrackerPlugin(ctx as any);

    const sessionCreated = plugin['session.created'];
    expect(typeof sessionCreated).toBe('function');

    const sessionData = {
      id: 'test-session',
      agent: { id: 'test-agent' }
    };
    await expect(sessionCreated(sessionData)).resolves.not.toThrow();

    const sessionIdle = plugin['session.idle'];
    expect(typeof sessionIdle).toBe('function');
    await expect(sessionIdle(sessionData)).resolves.not.toThrow();

    const sessionDeleted = plugin['session.deleted'];
    expect(typeof sessionDeleted).toBe('function');
    await expect(sessionDeleted(sessionData)).resolves.not.toThrow();
  });

  it('should handle event notifications', async () => {
    const ctx = makeMockContext();
    const plugin: Plugin = await AgentTrackerPlugin(ctx as any);

    const eventHandler = plugin['event'];
    expect(typeof eventHandler).toBe('function');

    const sessionCreatedEvent = { event: { type: 'session.created' } };
    await expect(eventHandler(sessionCreatedEvent)).resolves.not.toThrow();

    const sessionIdleEvent = { event: { type: 'session.idle' } };
    await expect(eventHandler(sessionIdleEvent)).resolves.not.toThrow();

    const unknownEvent = { event: { type: 'unknown' } };
    await expect(eventHandler(unknownEvent)).resolves.not.toThrow();
  });
});
