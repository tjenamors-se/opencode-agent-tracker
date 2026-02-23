import { TrackingService } from '../../src/tracking-service';
import { MockDatabase } from '../../src/mock-database';
import { WriteBuffer } from '../../src/write-buffer';
import type { AgentData, RetrospectiveEntry, ActivityEntry } from '../../src/types';

describe('TrackingService', () => {
  let trackingService: TrackingService;
  let mockDB: MockDatabase;
  let writeBuffer: WriteBuffer;
  let mockClient: any;

  const makeAgent = (overrides: Partial<AgentData> = {}): AgentData => ({
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
    updated_at: new Date(),
    ...overrides
  });

  beforeEach(() => {
    mockDB = new MockDatabase();
    writeBuffer = new WriteBuffer();
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
    trackingService = new TrackingService(mockDB, writeBuffer, mockClient);
  });

  describe('trackToolUsage', () => {
    it('should buffer XP increment for successful tool usage', async () => {
      await mockDB.putAgent('test-agent', makeAgent());

      await trackingService.trackToolUsage(
        { agentId: 'test-agent', tool: 'read' },
        { success: true }
      );

      expect(writeBuffer.size).toBeGreaterThan(0);
      const dbAgent = await mockDB.getAgent('test-agent');
      expect(dbAgent?.experience_points).toBe(0);
    });

    it('should not buffer for unsuccessful tool usage', async () => {
      await trackingService.trackToolUsage(
        { agentId: 'test-agent', tool: 'read' },
        { success: false }
      );

      expect(writeBuffer.isEmpty).toBe(true);
    });

    it('should not buffer when db is unavailable', async () => {
      mockDB.setAvailable(false);
      await trackingService.trackToolUsage(
        { agentId: 'test-agent', tool: 'read' },
        { success: true }
      );
      expect(writeBuffer.isEmpty).toBe(true);
    });
  });

  describe('trackCommandCompletion', () => {
    it('should buffer XP for successful command', async () => {
      await mockDB.putAgent('test-agent', makeAgent());

      await trackingService.trackCommandCompletion({
        command: 'git commit',
        success: true,
        agentId: 'test-agent'
      });

      expect(writeBuffer.size).toBeGreaterThan(0);
    });

    it('should not buffer for unsuccessful command', async () => {
      await trackingService.trackCommandCompletion({
        command: 'git commit',
        success: false,
        agentId: 'test-agent'
      });
      expect(writeBuffer.isEmpty).toBe(true);
    });
  });

  describe('commitCompleted', () => {
    it('should buffer commit data and agent XP/commit count', async () => {
      await mockDB.putAgent('test-agent', makeAgent());

      await trackingService.commitCompleted('test-agent', 'abc123', '/project', 'Test task');

      expect(writeBuffer.size).toBeGreaterThan(0);

      const dbAgent = await mockDB.getAgent('test-agent');
      expect(dbAgent?.experience_points).toBe(0);
      expect(dbAgent?.total_commits).toBe(0);
    });

    it('should write to DB only after flush', async () => {
      await mockDB.putAgent('test-agent', makeAgent());

      await trackingService.commitCompleted('test-agent', 'abc123', '/project', 'Test task');
      await trackingService.flushWriteBuffer();

      const dbAgent = await mockDB.getAgent('test-agent');
      expect(dbAgent?.experience_points).toBe(5);
      expect(dbAgent?.total_commits).toBe(1);

      const commit = await mockDB.getCommit('/project', 'abc123');
      expect(commit?.task_description).toBe('Test task');
    });
  });

  describe('recordCommunicationScore', () => {
    it('should buffer CS event and agent score update', async () => {
      await mockDB.putAgent('test-agent', makeAgent());

      await trackingService.recordCommunicationScore('test-agent', 'abc123', '/project', 2);

      expect(writeBuffer.size).toBeGreaterThan(0);
      const dbAgent = await mockDB.getAgent('test-agent');
      expect(dbAgent?.communication_score).toBe(60);
    });

    it('should accept excellence grade (5)', async () => {
      await mockDB.putAgent('test-agent', makeAgent());

      await trackingService.recordCommunicationScore('test-agent', 'abc123', '/project', 5);
      await trackingService.flushWriteBuffer();

      const dbAgent = await mockDB.getAgent('test-agent');
      expect(dbAgent?.communication_score).toBe(65);
    });

    it('should accept bad grade (-1)', async () => {
      await mockDB.putAgent('test-agent', makeAgent());

      await trackingService.recordCommunicationScore('test-agent', 'abc123', '/project', -1);
      await trackingService.flushWriteBuffer();

      const dbAgent = await mockDB.getAgent('test-agent');
      expect(dbAgent?.communication_score).toBe(59);
    });

    it('should not go below 0', async () => {
      await mockDB.putAgent('test-agent', makeAgent({ communication_score: 0 }));

      await trackingService.recordCommunicationScore('test-agent', 'abc123', '/project', -1);
      await trackingService.flushWriteBuffer();

      const dbAgent = await mockDB.getAgent('test-agent');
      expect(dbAgent?.communication_score).toBe(0);
    });
  });

  describe('initializeSessionTracking', () => {
    it('should create new agent and buffer it', async () => {
      const session = { id: 'session-1', agent: { id: 'new-agent' } };

      await trackingService.initializeSessionTracking(session);

      expect(writeBuffer.size).toBe(1);

      await trackingService.flushWriteBuffer();
      const agent = await mockDB.getAgent('new-agent');
      expect(agent?.id).toBe('new-agent');
      expect(agent?.skill_points).toBe(1);
      expect(agent?.communication_score).toBe(60);
    });

    it('should not re-create existing agent', async () => {
      await mockDB.putAgent('existing-agent', makeAgent({ id: 'existing-agent', skill_points: 3 }));

      const session = { id: 'session-1', agent: { id: 'existing-agent' } };
      await trackingService.initializeSessionTracking(session);

      expect(writeBuffer.isEmpty).toBe(true);
    });
  });

  describe('finalizeSession', () => {
    it('should flush write buffer on session end', async () => {
      await mockDB.putAgent('test-agent', makeAgent());

      await trackingService.commitCompleted('test-agent', 'abc123', '/project', 'Task');
      expect(writeBuffer.size).toBeGreaterThan(0);

      const session = { id: 'session-1', agent: { id: 'test-agent' } };
      await trackingService.finalizeSession(session);

      expect(writeBuffer.isEmpty).toBe(true);
      const dbAgent = await mockDB.getAgent('test-agent');
      expect(dbAgent?.total_commits).toBe(1);
    });
  });

  describe('flushWriteBuffer', () => {
    it('should return FlushResult', async () => {
      await mockDB.putAgent('test-agent', makeAgent());
      await trackingService.commitCompleted('test-agent', 'abc123', '/project', 'Task');

      const result = await trackingService.flushWriteBuffer();
      expect(result.entriesWritten).toBeGreaterThan(0);
      expect(result.errors).toEqual([]);
    });

    it('should clear agent cache after flush', async () => {
      await mockDB.putAgent('test-agent', makeAgent());
      await trackingService.trackToolUsage({ agentId: 'test-agent' }, { success: true });
      await trackingService.flushWriteBuffer();

      await mockDB.putAgent('test-agent', makeAgent({ experience_points: 999 }));
      const status = await trackingService.getAgentStatus('test-agent');
      expect(status?.experience_points).toBe(999);
    });
  });

  describe('getAgentStatus (R8.1)', () => {
    it('should return agent status', async () => {
      await mockDB.putAgent('test-agent', makeAgent({ skill_points: 2, experience_points: 50 }));

      const status = await trackingService.getAgentStatus('test-agent');
      expect(status?.id).toBe('test-agent');
      expect(status?.skill_points).toBe(2);
      expect(status?.experience_points).toBe(50);
      expect(status?.halted).toBe(false);
      expect(status?.active).toBe(true);
    });

    it('should return null for non-existent agent', async () => {
      const status = await trackingService.getAgentStatus('nonexistent');
      expect(status).toBeNull();
    });

    it('should report halted when SP <= 0', async () => {
      await mockDB.putAgent('halted-agent', makeAgent({ id: 'halted-agent', skill_points: 0 }));

      const status = await trackingService.getAgentStatus('halted-agent');
      expect(status?.halted).toBe(true);
    });
  });

  describe('reportBug (R8.1)', () => {
    it('should decrement SP and increment bugs', async () => {
      await mockDB.putAgent('bug-agent', makeAgent({ id: 'bug-agent', skill_points: 2 }));

      await trackingService.reportBug('bug-agent');
      await trackingService.flushWriteBuffer();

      const agent = await mockDB.getAgent('bug-agent');
      expect(agent?.skill_points).toBe(1);
      expect(agent?.total_bugs).toBe(1);
    });

    it('should halt agent when SP reaches 0', async () => {
      await mockDB.putAgent('halt-agent', makeAgent({ id: 'halt-agent', skill_points: 1 }));

      await trackingService.reportBug('halt-agent');
      await trackingService.flushWriteBuffer();

      const agent = await mockDB.getAgent('halt-agent');
      expect(agent?.skill_points).toBe(0);
      expect(agent?.active).toBe(false);
      expect(mockClient.tui.toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'error' })
      );
    });
  });

  describe('recordCommitGrade (R8.2)', () => {
    it('should apply both grades to CS', async () => {
      await mockDB.putAgent('grade-agent', makeAgent({ id: 'grade-agent', communication_score: 60 }));

      await trackingService.recordCommitGrade('grade-agent', 'abc123', '/project', 2, 2);
      await trackingService.flushWriteBuffer();

      const agent = await mockDB.getAgent('grade-agent');
      expect(agent?.communication_score).toBe(64);
    });

    it('should handle excellence + good grades', async () => {
      await mockDB.putAgent('exc-agent', makeAgent({ id: 'exc-agent', communication_score: 60 }));

      await trackingService.recordCommitGrade('exc-agent', 'abc123', '/project', 5, 2);
      await trackingService.flushWriteBuffer();

      const agent = await mockDB.getAgent('exc-agent');
      expect(agent?.communication_score).toBe(67);
    });

    it('should handle bad + bad grades', async () => {
      await mockDB.putAgent('bad-agent', makeAgent({ id: 'bad-agent', communication_score: 60 }));

      await trackingService.recordCommitGrade('bad-agent', 'abc123', '/project', -1, -1);
      await trackingService.flushWriteBuffer();

      const agent = await mockDB.getAgent('bad-agent');
      expect(agent?.communication_score).toBe(58);
    });

    it('should buffer retrospective entry', async () => {
      await mockDB.putAgent('retro-agent', makeAgent({ id: 'retro-agent' }));

      await trackingService.recordCommitGrade('retro-agent', 'abc123', '/project', 2, 5);
      await trackingService.flushWriteBuffer();

      const retros = await mockDB.getRetrospectives('retro-agent');
      expect(retros.length).toBe(1);
      expect(retros[0]?.agent_grade).toBe(2);
      expect(retros[0]?.user_grade).toBe(5);
      expect(retros[0]?.score_before).toBe(60);
      expect(retros[0]?.score_after).toBe(67);
    });

    it('should increment XP by 1 for commit grade', async () => {
      await mockDB.putAgent('xp-agent', makeAgent({ id: 'xp-agent', experience_points: 0 }));

      await trackingService.recordCommitGrade('xp-agent', 'abc123', '/project', 1, 1);
      await trackingService.flushWriteBuffer();

      const agent = await mockDB.getAgent('xp-agent');
      expect(agent?.experience_points).toBe(1);
    });
  });

  describe('recordRetrospective (R8.2)', () => {
    it('should buffer retrospective entry', async () => {
      const entry: RetrospectiveEntry = {
        commit: 'abc123',
        timestamp: '2026-02-23T18:00:00Z',
        task: 'Test task',
        agent_grade: 2,
        user_grade: 2,
        score_before: 60,
        score_after: 64,
        agent_note: 'Good',
        user_note: ''
      };

      await trackingService.recordRetrospective('retro-agent', entry);
      expect(writeBuffer.size).toBe(1);

      await trackingService.flushWriteBuffer();
      const stored = await mockDB.getRetrospectives('retro-agent');
      expect(stored.length).toBe(1);
    });
  });

  describe('logActivity (R8.3)', () => {
    it('should buffer activity entry', async () => {
      const entry: ActivityEntry = {
        timestamp: '2026-02-23T18:00:00Z',
        task: 'Write specs',
        actions: 'Analyzed bugs',
        outcome: 'Specs written',
        decisions: 'Proceed'
      };

      await trackingService.logActivity('activity-agent', entry);
      expect(writeBuffer.size).toBe(1);

      await trackingService.flushWriteBuffer();
      const stored = await mockDB.getActivities('activity-agent');
      expect(stored.length).toBe(1);
    });
  });

  describe('write batching (R6)', () => {
    it('should collapse multiple agent updates into one buffer entry', async () => {
      await mockDB.putAgent('collapse-agent', makeAgent({ id: 'collapse-agent' }));

      await trackingService.trackToolUsage({ agentId: 'collapse-agent' }, { success: true });
      await trackingService.trackToolUsage({ agentId: 'collapse-agent' }, { success: true });
      await trackingService.trackToolUsage({ agentId: 'collapse-agent' }, { success: true });

      expect(writeBuffer.size).toBe(1);

      await trackingService.flushWriteBuffer();
      const agent = await mockDB.getAgent('collapse-agent');
      expect(agent?.experience_points).toBe(3);
    });

    it('should not write to DB until flush', async () => {
      await mockDB.putAgent('nowrite-agent', makeAgent({ id: 'nowrite-agent' }));

      await trackingService.commitCompleted('nowrite-agent', 'abc', '/p', 'Task');
      await trackingService.recordCommunicationScore('nowrite-agent', 'abc', '/p', 2);
      await trackingService.trackToolUsage({ agentId: 'nowrite-agent' }, { success: true });

      const dbAgent = await mockDB.getAgent('nowrite-agent');
      expect(dbAgent?.experience_points).toBe(0);
      expect(dbAgent?.total_commits).toBe(0);
      expect(dbAgent?.communication_score).toBe(60);
    });
  });
});

describe('TrackingService - branch coverage', () => {
  let trackingService: TrackingService;
  let mockDB: MockDatabase;
  let writeBuffer: WriteBuffer;
  let mockClient: any;

  const makeAgent = (overrides: Partial<AgentData> = {}): AgentData => ({
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
    updated_at: new Date(),
    ...overrides
  });

  beforeEach(() => {
    mockDB = new MockDatabase();
    writeBuffer = new WriteBuffer();
    mockClient = {
      app: { log: jest.fn().mockResolvedValue(true) },
      tui: { toast: { show: jest.fn().mockResolvedValue(true) } }
    };
    trackingService = new TrackingService(mockDB, writeBuffer, mockClient);
  });

  it('should trigger level-up on commitCompleted when XP reaches threshold', async () => {
    await mockDB.putAgent('levelup-agent', makeAgent({
      id: 'levelup-agent',
      skill_points: 1,
      experience_points: 9995
    }));

    await trackingService.commitCompleted('levelup-agent', 'abc', '/p', 'Task');
    await trackingService.flushWriteBuffer();

    const agent = await mockDB.getAgent('levelup-agent');
    expect(agent?.skill_points).toBe(2);
    expect(agent?.experience_points).toBe(0);
    expect(mockClient.tui.toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success' })
    );
  });

  it('should trigger level-up on recordCommitGrade when XP reaches threshold', async () => {
    await mockDB.putAgent('grade-levelup', makeAgent({
      id: 'grade-levelup',
      skill_points: 1,
      experience_points: 9999
    }));

    await trackingService.recordCommitGrade('grade-levelup', 'abc', '/p', 1, 1);
    await trackingService.flushWriteBuffer();

    const agent = await mockDB.getAgent('grade-levelup');
    expect(agent?.skill_points).toBe(2);
    expect(agent?.experience_points).toBe(0);
  });

  it('should handle generateRetrospective with null agentId', async () => {
    const session = { id: 'session-1' };
    await expect(trackingService.generateRetrospective(session)).resolves.not.toThrow();
  });

  it('should handle finalizeSession with null agentId', async () => {
    const session = { id: 'session-1' };
    await expect(trackingService.finalizeSession(session)).resolves.not.toThrow();
  });

  it('should handle commitCompleted with non-existent agent', async () => {
    await expect(
      trackingService.commitCompleted('nonexistent', 'abc', '/p', 'Task')
    ).resolves.not.toThrow();
    expect(writeBuffer.isEmpty).toBe(true);
  });

  it('should handle recordCommunicationScore with non-existent agent', async () => {
    await expect(
      trackingService.recordCommunicationScore('nonexistent', 'abc', '/p', 2)
    ).resolves.not.toThrow();
  });
});
