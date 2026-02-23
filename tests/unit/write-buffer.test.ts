import { WriteBuffer } from '../../src/write-buffer';
import { MockDatabase } from '../../src/mock-database';
import type { AgentData, CommitData, CommunicationScoreEvent, RetrospectiveEntry, ActivityEntry } from '../../src/types';

describe('WriteBuffer', () => {
  let buffer: WriteBuffer;
  let mockDb: MockDatabase;

  beforeEach(() => {
    buffer = new WriteBuffer();
    mockDb = new MockDatabase();
  });

  describe('buffering', () => {
    it('should start empty', () => {
      expect(buffer.isEmpty).toBe(true);
      expect(buffer.size).toBe(0);
    });

    it('should buffer agent data', () => {
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
      buffer.bufferAgent('test-agent', agentData);
      expect(buffer.size).toBe(1);
      expect(buffer.isEmpty).toBe(false);
    });

    it('should buffer commit data', () => {
      const commitData: CommitData = {
        agent_id: 'test-agent',
        commit_hash: 'abc123',
        project_path: '/test',
        task_description: 'Test',
        experience_gained: 1,
        communication_score_change: 0,
        timestamp: new Date()
      };
      buffer.bufferCommit('/test', 'abc123', commitData);
      expect(buffer.size).toBe(1);
    });

    it('should buffer communication event', () => {
      const event: CommunicationScoreEvent = {
        agent_id: 'test-agent',
        commit_hash: 'abc123',
        project_path: '/test',
        grade: 2,
        timestamp: new Date()
      };
      buffer.bufferCommunicationEvent(event);
      expect(buffer.size).toBe(1);
    });

    it('should buffer retrospective entry', () => {
      const entry: RetrospectiveEntry = {
        commit: 'abc123',
        timestamp: '2026-02-23T18:00:00Z',
        task: 'Test',
        agent_grade: 2,
        user_grade: 2,
        score_before: 60,
        score_after: 64,
        agent_note: 'Good',
        user_note: ''
      };
      buffer.bufferRetrospective('test-agent', 'abc123', entry);
      expect(buffer.size).toBe(1);
    });

    it('should buffer activity entry', () => {
      const entry: ActivityEntry = {
        timestamp: '2026-02-23T18:00:00Z',
        task: 'Test',
        actions: 'Tested',
        outcome: 'Success',
        decisions: 'Continue'
      };
      buffer.bufferActivity('test-agent', entry);
      expect(buffer.size).toBe(1);
    });

    it('should collapse duplicate agent keys (last-write-wins)', () => {
      const agent1: AgentData = {
        id: 'test-agent', name: 'Agent v1', model: 'm', scope: 's',
        skill_points: 1, experience_points: 0, communication_score: 60,
        total_commits: 0, total_bugs: 0, active: true,
        created_at: new Date(), updated_at: new Date()
      };
      const agent2: AgentData = { ...agent1, name: 'Agent v2', experience_points: 5 };

      buffer.bufferAgent('test-agent', agent1);
      buffer.bufferAgent('test-agent', agent2);
      expect(buffer.size).toBe(1);
    });
  });

  describe('flush', () => {
    it('should flush empty buffer as no-op', async () => {
      const result = await buffer.flush(mockDb);
      expect(result.entriesWritten).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('should flush agent data to database', async () => {
      const agentData: AgentData = {
        id: 'flush-agent', name: 'Flush Agent', model: 'm', scope: 's',
        skill_points: 1, experience_points: 10, communication_score: 70,
        total_commits: 3, total_bugs: 0, active: true,
        created_at: new Date(), updated_at: new Date()
      };
      buffer.bufferAgent('flush-agent', agentData);
      const result = await buffer.flush(mockDb);

      expect(result.entriesWritten).toBe(1);
      expect(result.errors).toEqual([]);

      const stored = await mockDb.getAgent('flush-agent');
      expect(stored?.name).toBe('Flush Agent');
      expect(stored?.experience_points).toBe(10);
    });

    it('should flush commit data to database', async () => {
      const commitData: CommitData = {
        agent_id: 'flush-agent', commit_hash: 'flush123',
        project_path: '/flush', task_description: 'Flush test',
        experience_gained: 5, communication_score_change: 2,
        timestamp: new Date()
      };
      buffer.bufferCommit('/flush', 'flush123', commitData);
      const result = await buffer.flush(mockDb);

      expect(result.entriesWritten).toBe(1);
      const stored = await mockDb.getCommit('/flush', 'flush123');
      expect(stored?.task_description).toBe('Flush test');
    });

    it('should flush retrospective to database', async () => {
      const entry: RetrospectiveEntry = {
        commit: 'retro123', timestamp: '2026-02-23T18:00:00Z',
        task: 'Retro test', agent_grade: 2, user_grade: 5,
        score_before: 60, score_after: 67,
        agent_note: 'Good', user_note: 'Excellence'
      };
      buffer.bufferRetrospective('retro-agent', 'retro123', entry);
      const result = await buffer.flush(mockDb);

      expect(result.entriesWritten).toBe(1);
      const stored = await mockDb.getRetrospectives('retro-agent');
      expect(stored.length).toBe(1);
      expect(stored[0]?.user_grade).toBe(5);
    });

    it('should flush activity to database', async () => {
      const entry: ActivityEntry = {
        timestamp: '2026-02-23T19:00:00Z', task: 'Activity test',
        actions: 'Wrote code', outcome: 'Tests pass', decisions: 'Ship it'
      };
      buffer.bufferActivity('activity-agent', entry);
      const result = await buffer.flush(mockDb);

      expect(result.entriesWritten).toBe(1);
      const stored = await mockDb.getActivities('activity-agent');
      expect(stored.length).toBe(1);
    });

    it('should flush multiple entry types in one call', async () => {
      const agentData: AgentData = {
        id: 'multi-agent', name: 'Multi', model: 'm', scope: 's',
        skill_points: 1, experience_points: 0, communication_score: 60,
        total_commits: 0, total_bugs: 0, active: true,
        created_at: new Date(), updated_at: new Date()
      };
      const commitData: CommitData = {
        agent_id: 'multi-agent', commit_hash: 'multi123',
        project_path: '/multi', task_description: 'Multi test',
        experience_gained: 5, communication_score_change: 0,
        timestamp: new Date()
      };

      buffer.bufferAgent('multi-agent', agentData);
      buffer.bufferCommit('/multi', 'multi123', commitData);
      const result = await buffer.flush(mockDb);

      expect(result.entriesWritten).toBe(2);
      expect(result.errors).toEqual([]);
    });

    it('should clear buffer after flush', async () => {
      const agentData: AgentData = {
        id: 'clear-agent', name: 'Clear', model: 'm', scope: 's',
        skill_points: 1, experience_points: 0, communication_score: 60,
        total_commits: 0, total_bugs: 0, active: true,
        created_at: new Date(), updated_at: new Date()
      };
      buffer.bufferAgent('clear-agent', agentData);
      expect(buffer.size).toBe(1);

      await buffer.flush(mockDb);
      expect(buffer.size).toBe(0);
      expect(buffer.isEmpty).toBe(true);
    });

    it('should collect errors on write failure', async () => {
      const agentData: AgentData = {
        id: 'fail-agent', name: 'Fail', model: 'm', scope: 's',
        skill_points: 1, experience_points: 0, communication_score: 60,
        total_commits: 0, total_bugs: 0, active: true,
        created_at: new Date(), updated_at: new Date()
      };
      buffer.bufferAgent('fail-agent', agentData);
      mockDb.setAvailable(false);

      const result = await buffer.flush(mockDb);
      expect(result.entriesWritten).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should write last-write-wins on duplicate keys', async () => {
      const agent1: AgentData = {
        id: 'dup-agent', name: 'Version 1', model: 'm', scope: 's',
        skill_points: 1, experience_points: 0, communication_score: 60,
        total_commits: 0, total_bugs: 0, active: true,
        created_at: new Date(), updated_at: new Date()
      };
      const agent2: AgentData = { ...agent1, name: 'Version 2', experience_points: 10 };

      buffer.bufferAgent('dup-agent', agent1);
      buffer.bufferAgent('dup-agent', agent2);

      const result = await buffer.flush(mockDb);
      expect(result.entriesWritten).toBe(1);

      const stored = await mockDb.getAgent('dup-agent');
      expect(stored?.name).toBe('Version 2');
      expect(stored?.experience_points).toBe(10);
    });
  });

  describe('clear', () => {
    it('should clear all buffered entries', () => {
      const agentData: AgentData = {
        id: 'clear-test', name: 'Clear', model: 'm', scope: 's',
        skill_points: 1, experience_points: 0, communication_score: 60,
        total_commits: 0, total_bugs: 0, active: true,
        created_at: new Date(), updated_at: new Date()
      };
      buffer.bufferAgent('clear-test', agentData);
      expect(buffer.size).toBe(1);

      buffer.clear();
      expect(buffer.size).toBe(0);
      expect(buffer.isEmpty).toBe(true);
    });
  });
});
