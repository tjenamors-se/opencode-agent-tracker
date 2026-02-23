import AgentTrackerPlugin from '../../src/index';
import type { Plugin } from '@opencode-ai/plugin';

describe('AgentTrackerPlugin', () => {
  it('should initialize plugin successfully', async () => {
    const mockContext = {
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
      $: {}
    };

    const plugin: Plugin = await AgentTrackerPlugin(mockContext as any);
    
    expect(typeof plugin).toBe('object');
    expect(plugin['tool.execute.before']).toBeDefined();
    expect(plugin['tool.execute.after']).toBeDefined();
    expect(plugin['command.executed']).toBeDefined();
    expect(plugin['session.created']).toBeDefined();
    expect(plugin['session.idle']).toBeDefined();
    expect(plugin['session.deleted']).toBeDefined();
    expect(plugin['event']).toBeDefined();
  });

  it('should handle tool execution hooks', async () => {
    const mockContext = {
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
      $: {}
    };

    const plugin: Plugin = await AgentTrackerPlugin(mockContext as any);
    
    // Test tool.execute.before hook
    const beforeHook = plugin['tool.execute.before'];
    expect(typeof beforeHook).toBe('function');
    
    // Test normal file access (should not throw)
    const normalInput = {
      tool: 'read',
      args: { filePath: '/path/to/package.json' }
    };
    await expect(beforeHook(normalInput)).resolves.not.toThrow();
    
    // Test .env file access (should throw)
    const envInput = {
      tool: 'read',
      args: { filePath: '/path/to/.env' }
    };
    await expect(beforeHook(envInput)).rejects.toThrow('Do not read .env files');
    
    // Test tool.execute.after hook
    const afterHook = plugin['tool.execute.after'];
    expect(typeof afterHook).toBe('function');
    
    // Test successful tool execution
    const successInput = { agentId: 'test-agent', tool: 'read' };
    const successOutput = { success: true };
    await expect(afterHook(successInput, successOutput)).resolves.not.toThrow();
    
    // Test unsuccessful tool execution
    const failOutput = { success: false };
    await expect(afterHook(successInput, failOutput)).resolves.not.toThrow();
  });

  it('should handle session hooks', async () => {
    const mockContext = {
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
      $: {}
    };

    const plugin: Plugin = await AgentTrackerPlugin(mockContext as any);
    
    // Test session.created hook
    const sessionCreated = plugin['session.created'];
    expect(typeof sessionCreated).toBe('function');
    
    const sessionData = {
      id: 'test-session',
      agent: { id: 'test-agent' }
    };
    await expect(sessionCreated(sessionData)).resolves.not.toThrow();
    
    // Test session.idle hook
    const sessionIdle = plugin['session.idle'];
    expect(typeof sessionIdle).toBe('function');
    await expect(sessionIdle(sessionData)).resolves.not.toThrow();
    
    // Test session.deleted hook
    const sessionDeleted = plugin['session.deleted'];
    expect(typeof sessionDeleted).toBe('function');
    await expect(sessionDeleted(sessionData)).resolves.not.toThrow();
  });

  it('should handle event notifications', async () => {
    const mockContext = {
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
      $: {}
    };

    const plugin: Plugin = await AgentTrackerPlugin(mockContext as any);
    
    // Test event handler
    const eventHandler = plugin['event'];
    expect(typeof eventHandler).toBe('function');
    
    // Test session.created event with LMDB unavailable
    const sessionCreatedEvent = { event: { type: 'session.created' } };
    await expect(eventHandler(sessionCreatedEvent)).resolves.not.toThrow();
    
    // Test session.idle event
    const sessionIdleEvent = { event: { type: 'session.idle' } };
    await expect(eventHandler(sessionIdleEvent)).resolves.not.toThrow();
    
    // Test unknown event type
    const unknownEvent = { event: { type: 'unknown' } };
    await expect(eventHandler(unknownEvent)).resolves.not.toThrow();
  });
});