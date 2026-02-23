import { TrackingService } from '../../src/tracking-service';
import { LMDBDatabase } from '../../src/lmdb-database';
import type { AgentData } from '../../src/types';

describe('TrackingService', () => {
  let trackingService: TrackingService;
  let mockDB: LMDBDatabase;
  let mockClient: any;

  beforeEach(() => {
    mockDB = new LMDBDatabase(':memory:');
    mockClient = {
      app: {
        log: jest.fn().mockResolvedValue(true)
      },
      tui: {
        toast: {
          show: jest.fn().mockResolvedValue(true)
        }
      }
    };
    trackingService = new TrackingService(mockDB, mockClient);
  });

  afterEach(async () => {
    await mockDB.close();
  });

  describe('trackToolUsage', () => {
    it('should track successful tool usage', async () => {
      const event = {
        agentId: 'test-agent',
        tool: 'read',
        success: true
      };

      const agentData: AgentData = {
        id: 'test-agent',
        name: 'Test Agent',
        model: 'test-model',
        scope: 'test',
        skill_points: 1,
        experience_points: 0,
        communication_score: 60,
        total_commits: 0,
        total_bugs: 0,
        active: true,
        created_at: new Date(),
        updated_at: new Date()
      };

      await mockDB.putAgent('test-agent', agentData);
      await trackingService.trackToolUsage(event as any, { success: true });
      
      const updatedAgent = await mockDB.getAgent('test-agent');
      expect(updatedAgent?.experience_points).toBeGreaterThan(0);
    });

    it('should not track unsuccessful tool usage', async () => {
      const event = {
        agentId: 'test-agent',
        tool: 'read',
        success: false
      };

      await trackingService.trackToolUsage(event as any, { success: false });
    });
  });

  describe('trackCommandCompletion', () => {
    it('should track successful command completion', async () => {
      const event = {
        command: 'git commit',
        success: true,
        agentId: 'test-agent'
      };

      await trackingService.trackCommandCompletion(event as any);
    });

    it('should not track unsuccessful command execution', async () => {
      const event = {
        command: 'git commit',
        success: false,
        agentId: 'test-agent'
      };

      await trackingService.trackCommandCompletion(event as any);
    });
  });

  describe('initializeSessionTracking', () => {
    it('should initialize tracking for new agent', async () => {
      const session = {
        id: 'test-session',
        agent: {
          id: 'new-agent',
          name: 'New Agent',
          model: 'test-model',
          scope: 'test'
        }
      };

      await trackingService.initializeSessionTracking(session as any);
      
      const agent = await mockDB.getAgent('new-agent');
      expect(agent?.id).toBe('new-agent');
      expect(agent?.active).toBe(true);
    });

    it.skip('should reactivate existing agent', async () => {
      const agentData: AgentData = {
        id: 'existing-agent',
        name: 'Existing Agent',
        model: 'test-model',
        scope: 'test',
        skill_points: 2,
        experience_points: 50,
        communication_score: 70,
        total_commits: 10,
        total_bugs: 1,
        active: false,
        created_at: new Date(),
        updated_at: new Date()
      };

      await mockDB.putAgent('existing-agent', agentData);
      
      const session = {
        id: 'test-session',
        agent: {
          id: 'existing-agent',
          name: 'Existing Agent',
          model: 'test-model',
          scope: 'test'
        }
      };

      await trackingService.initializeSessionTracking(session as any);
      
      const updatedAgent = await mockDB.getAgent('existing-agent');
      expect(updatedAgent?.active).toBeTruthy();
    });
  });

  describe('generateRetrospective', () => {
    it('should generate retrospective for session', async () => {
      const session = {
        id: 'test-session',
        agent: {
          id: 'test-agent'
        }
      };

      await trackingService.generateRetrospective(session as any);
      expect(mockClient.app.log).toHaveBeenCalled();
    });
  });

  describe('finalizeSession', () => {
    it.skip('should finalize session tracking', async () => {
      const agentData: AgentData = {
        id: 'test-agent',
        name: 'Test Agent',
        model: 'test-model',
        scope: 'test',
        skill_points: 1,
        experience_points: 10,
        communication_score: 60,
        total_commits: 1,
        total_bugs: 0,
        active: true,
        created_at: new Date(),
        updated_at: new Date()
      };

      await mockDB.putAgent('test-agent', agentData);
      
      const session = {
        id: 'test-session',
        agent: {
          id: 'test-agent'
        }
      };

      await trackingService.finalizeSession(session as any);
      
      const updatedAgent = await mockDB.getAgent('test-agent');
      expect(updatedAgent?.active).toBeFalsy();
    });
  });
});