import { LMDBDatabase } from '../../src/lmdb-database';
import type { AgentData, CommitData, CommunicationScoreEvent } from '../../src/types';

describe('LMDBDatabase', () => {
  let db: LMDBDatabase;
  let mockDB: any;

  beforeEach(() => {
    db = new LMDBDatabase(':memory:'); // Use in-memory database for testing
  });

  afterEach(async () => {
    await db.close();
  });

  describe('constructor', () => {
    it('should initialize database', () => {
      expect(db.isAvailable).toBe(true);
    });
  });

  describe('putAgent', () => {
    it('should store agent data', async () => {
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

      const result = await db.putAgent('test-agent', agentData);
      expect(result).toBe(true);
    });

  it.skip('should return false when database is unavailable', async () => {
    // Mock the initialize method to return false
    const mockDB = new LMDBDatabase(':memory:');
    mockDB['initialize'] = jest.fn(() => false);
    
    const result = await mockDB.putAgent('test', {} as AgentData);
    expect(result).toBe(false);
    await mockDB.close();
  });
  });

  describe('getAgent', () => {
    it('should retrieve stored agent data', async () => {
      const agentData: AgentData = {
        id: 'test-agent',
        name: 'Test Agent',
        model: 'test-model',
        scope: 'test',
        skill_points: 1,
        experience_points: 100,
        communication_score: 80,
        total_commits: 5,
        total_bugs: 0,
        active: true,
        created_at: new Date(),
        updated_at: new Date()
      };

      await db.putAgent('test-agent', agentData);
      const retrieved = await db.getAgent('test-agent');
      expect(retrieved?.id).toBe('test-agent');
      expect(retrieved?.experience_points).toBeGreaterThan(0);
    });

  it.skip('should return null for non-existent agent', async () => {
    const result = await db.getAgent('non-existent-agent-id');
    expect(result).toBeNull();
  });
  });

  describe('putCommit', () => {
    it('should store commit data', async () => {
      const commitData: CommitData = {
        agent_id: 'test-agent',
        commit_hash: 'abc123',
        project_path: '/test/project',
        task_description: 'Test commit',
        experience_gained: 1,
        communication_score_change: 2,
        timestamp: new Date()
      };

      const result = await db.putCommit('/test/project', 'abc123', commitData);
      expect(result).toBe(true);
    });
  });

  describe('getCommit', () => {
    it('should retrieve stored commit data', async () => {
      const commitData: CommitData = {
        agent_id: 'test-agent',
        commit_hash: 'abc123',
        project_path: '/test/project',
        task_description: 'Test commit',
        experience_gained: 1,
        communication_score_change: 2,
        timestamp: new Date()
      };

      await db.putCommit('/test/project', 'abc123', commitData);
      const retrieved = await db.getCommit('/test/project', 'abc123');
      expect(retrieved?.agent_id).toBe('test-agent');
      expect(retrieved?.task_description).toBe('Test commit');
    });
  });

  describe('putCommunicationEvent', () => {
    it('should store communication event', async () => {
      const event: CommunicationScoreEvent = {
        agent_id: 'test-agent',
        commit_hash: 'abc123',
        project_path: '/test/project',
        grade: 2,
        timestamp: new Date(),
        reason: 'Excellent collaboration'
      };

      const result = await db.putCommunicationEvent(event);
      expect(result).toBe(true);
    });
  });

  describe('getCommunicationEvents', () => {
    it('should retrieve communication events for agent', async () => {
      const event: CommunicationScoreEvent = {
        agent_id: 'test-agent',
        commit_hash: 'abc123',
        project_path: '/test/project',
        grade: 1,
        timestamp: new Date()
      };

      await db.putCommunicationEvent(event);
      const events = await db.getCommunicationEvents('test-agent');
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].agent_id).toBe('test-agent');
    });

    it('should limit results when specified', async () => {
      const events = await db.getCommunicationEvents('test-agent', 1);
      expect(events.length).toBeLessThanOrEqual(1);
    });
  });

  describe('close', () => {
    it('should close database connection', async () => {
      await db.close();
      expect(db.isAvailable).toBe(false);
    });
  });
});