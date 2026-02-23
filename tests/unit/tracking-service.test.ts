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
        },
        input: {
          text: jest.fn().mockResolvedValue('')
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

    it('should not crash when client.app.log throws', async () => {
      mockClient.app.log = jest.fn().mockRejectedValue(new Error('log failed'));
      await mockDB.putAgent('test-agent', makeAgent());

      await expect(
        trackingService.trackToolUsage({ agentId: 'test-agent' }, { success: true })
      ).resolves.not.toThrow();
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

    it('should flush even when session has no agentId', async () => {
      await mockDB.putAgent('test-agent', makeAgent());
      await trackingService.commitCompleted('test-agent', 'abc123', '/project', 'Task');
      expect(writeBuffer.size).toBeGreaterThan(0);

      const session = { id: 'session-no-agent' };
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

    it('should prompt for retrospective fields via client.tui.input.text', async () => {
      mockClient.tui.input.text = jest.fn()
        .mockResolvedValueOnce('Fix login bug')
        .mockResolvedValueOnce('Smooth execution')
        .mockResolvedValueOnce('Good work');

      await mockDB.putAgent('prompt-agent', makeAgent({ id: 'prompt-agent' }));

      await trackingService.recordCommitGrade('prompt-agent', 'abc123', '/project', 2, 2);
      await trackingService.flushWriteBuffer();

      const retros = await mockDB.getRetrospectives('prompt-agent');
      expect(retros.length).toBe(1);
      expect(retros[0]?.task).toBe('Fix login bug');
      expect(retros[0]?.agent_note).toBe('Smooth execution');
      expect(retros[0]?.user_note).toBe('Good work');
    });

    it('should fall back to empty strings when input is unavailable', async () => {
      delete mockClient.tui.input;

      await mockDB.putAgent('noinput-agent', makeAgent({ id: 'noinput-agent' }));

      await trackingService.recordCommitGrade('noinput-agent', 'abc123', '/project', 2, 2);
      await trackingService.flushWriteBuffer();

      const retros = await mockDB.getRetrospectives('noinput-agent');
      expect(retros.length).toBe(1);
      expect(retros[0]?.task).toBe('');
      expect(retros[0]?.agent_note).toBe('');
      expect(retros[0]?.user_note).toBe('');
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

  describe('graceful degradation', () => {
    it('should not crash when client is null', async () => {
      const nullClientService = new TrackingService(mockDB, writeBuffer, null);
      await mockDB.putAgent('test-agent', makeAgent());

      await expect(
        nullClientService.trackToolUsage({ agentId: 'test-agent' }, { success: true })
      ).resolves.not.toThrow();
    });

    it('should not crash when client.app is undefined', async () => {
      const badClient = { tui: { toast: { show: jest.fn() } } };
      const badClientService = new TrackingService(mockDB, writeBuffer, badClient);
      await mockDB.putAgent('test-agent', makeAgent());

      await expect(
        badClientService.trackToolUsage({ agentId: 'test-agent' }, { success: true })
      ).resolves.not.toThrow();
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
      tui: {
        toast: { show: jest.fn().mockResolvedValue(true) },
        input: { text: jest.fn().mockResolvedValue('') }
      }
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

  it('should handle finalizeSession with null agentId and still flush', async () => {
    await mockDB.putAgent('test-agent', makeAgent());
    await trackingService.trackToolUsage({ agentId: 'test-agent' }, { success: true });
    expect(writeBuffer.size).toBeGreaterThan(0);

    const session = { id: 'session-1' };
    await trackingService.finalizeSession(session);

    expect(writeBuffer.isEmpty).toBe(true);
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

describe('TrackingService - checkAgentHealth', () => {
  let trackingService: TrackingService;
  let mockDB: MockDatabase;
  let writeBuffer: WriteBuffer;
  let mockClient: any;

  const makeAgent = (overrides: Partial<AgentData> = {}): AgentData => ({
    id: 'health-agent',
    name: 'Health Agent',
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
      tui: {
        toast: { show: jest.fn().mockResolvedValue(true) },
        input: { text: jest.fn().mockResolvedValue('') }
      }
    };
    trackingService = new TrackingService(mockDB, writeBuffer, mockClient);
  });

  it('should return healthy status for agent with SP > 0', async () => {
    await mockDB.putAgent('health-agent', makeAgent({ skill_points: 2, experience_points: 10 }));

    const health = await trackingService.checkAgentHealth('health-agent', process.cwd());

    expect(health.agent_id).toBe('health-agent');
    expect(health.skill_points).toBe(2);
    expect(health.experience_points).toBe(10);
    expect(health.halted).toBe(false);
    expect(health.checked_at).toBeInstanceOf(Date);
  });

  it('should return halted status when SP is 0', async () => {
    await mockDB.putAgent('halted-health', makeAgent({ id: 'halted-health', skill_points: 0 }));

    const health = await trackingService.checkAgentHealth('halted-health', process.cwd());

    expect(health.halted).toBe(true);
    expect(health.skill_points).toBe(0);
  });

  it('should return halted status when SP is negative', async () => {
    await mockDB.putAgent('neg-sp', makeAgent({ id: 'neg-sp', skill_points: -1 }));

    const health = await trackingService.checkAgentHealth('neg-sp', process.cwd());

    expect(health.halted).toBe(true);
    expect(health.skill_points).toBe(-1);
  });

  it('should return halted=true with defaults for unknown agent', async () => {
    const health = await trackingService.checkAgentHealth('nonexistent-health', process.cwd());

    expect(health.halted).toBe(true);
    expect(health.skill_points).toBe(0);
    expect(health.experience_points).toBe(0);
    expect(health.communication_score).toBe(0);
  });

  it('should include pending_changes as an array', async () => {
    await mockDB.putAgent('pending-agent', makeAgent({ id: 'pending-agent' }));

    const health = await trackingService.checkAgentHealth('pending-agent', process.cwd());

    expect(Array.isArray(health.pending_changes)).toBe(true);
  });

  it('should include all agent fields in health status', async () => {
    await mockDB.putAgent('full-health', makeAgent({
      id: 'full-health',
      skill_points: 3,
      experience_points: 50,
      communication_score: 80,
      total_commits: 10,
      total_bugs: 1
    }));

    const health = await trackingService.checkAgentHealth('full-health', process.cwd());

    expect(health.total_commits).toBe(10);
    expect(health.total_bugs).toBe(1);
    expect(health.communication_score).toBe(80);
  });
});

describe('TrackingService.getPendingGitChanges', () => {
  it('should return an array', () => {
    const changes = TrackingService.getPendingGitChanges(process.cwd());
    expect(Array.isArray(changes)).toBe(true);
  });

  it('should return empty array for invalid directory', () => {
    const changes = TrackingService.getPendingGitChanges('/nonexistent/path/that/does/not/exist');
    expect(changes).toEqual([]);
  });

  it('should return empty array when git is not available', () => {
    const changes = TrackingService.getPendingGitChanges('/tmp');
    expect(changes).toEqual([]);
  });
});
