import { LMDBDatabase } from '../../src/lmdb-database';
import type { AgentData, CommitData, CommunicationScoreEvent, RetrospectiveEntry, ActivityEntry } from '../../src/types';

describe('LMDBDatabase', () => {
  let db: LMDBDatabase;

  beforeEach(() => {
    db = new LMDBDatabase(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  describe('constructor', () => {
    it('should initialize with string path (backwards compat)', () => {
      expect(db.isAvailable).toBe(true);
    });

    it('should initialize with DatabaseConfig object', async () => {
      const configDb = new LMDBDatabase({ path: ':memory:' });
      expect(configDb.isAvailable).toBe(true);
      await configDb.close();
    });

    it('should reject mapSize below 1 MB', () => {
      const badDb = new LMDBDatabase({ path: ':memory:', maxSize: 100 });
      expect(badDb.isAvailable).toBe(false);
    });

    it('should reject mapSize above 2 GB', () => {
      const badDb = new LMDBDatabase({ path: ':memory:', maxSize: 3 * 1024 * 1024 * 1024 });
      expect(badDb.isAvailable).toBe(false);
    });

    it('should accept valid mapSize', async () => {
      const goodDb = new LMDBDatabase({ path: ':memory:', maxSize: 100 * 1024 * 1024 });
      expect(goodDb.isAvailable).toBe(true);
      await goodDb.close();
    });
  });

  describe('putAgent / getAgent', () => {
    const agentData: AgentData = {
      id: 'agent-put-get',
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

    it('should store agent data', async () => {
      const result = await db.putAgent('agent-put-get', agentData);
      expect(result).toBe(true);
    });

    it('should retrieve stored agent data', async () => {
      await db.putAgent('agent-retrieve', { ...agentData, id: 'agent-retrieve' });
      const retrieved = await db.getAgent('agent-retrieve');
      expect(retrieved?.id).toBe('agent-retrieve');
      expect(retrieved?.skill_points).toBe(1);
    });

    it('should return null for non-existent agent', async () => {
      const result = await db.getAgent('non-existent-unique-id');
      expect(result).toBeNull();
    });

    it('should return false when database is unavailable', async () => {
      await db.close();
      const result = await db.putAgent('test', agentData);
      expect(result).toBe(false);
    });

    it('should return null when database is unavailable', async () => {
      await db.close();
      const result = await db.getAgent('test');
      expect(result).toBeNull();
    });
  });

  describe('putCommit / getCommit', () => {
    const commitData: CommitData = {
      agent_id: 'commit-agent',
      commit_hash: 'abc123',
      project_path: '/test/project',
      task_description: 'Test commit',
      experience_gained: 1,
      communication_score_change: 2,
      timestamp: new Date()
    };

    it('should store commit data', async () => {
      const result = await db.putCommit('/test/project', 'store-abc', commitData);
      expect(result).toBe(true);
    });

    it('should retrieve stored commit data', async () => {
      await db.putCommit('/test/project', 'retrieve-abc', commitData);
      const retrieved = await db.getCommit('/test/project', 'retrieve-abc');
      expect(retrieved?.agent_id).toBe('commit-agent');
      expect(retrieved?.task_description).toBe('Test commit');
    });

    it('should return null for non-existent commit', async () => {
      const result = await db.getCommit('/test', 'unique-nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('putCommunicationEvent / getCommunicationEvents', () => {
    it('should store communication event', async () => {
      const event: CommunicationScoreEvent = {
        agent_id: 'comm-store-agent',
        commit_hash: 'abc123',
        project_path: '/test/project',
        grade: 2,
        timestamp: new Date(),
        reason: 'Excellent collaboration'
      };
      const result = await db.putCommunicationEvent(event);
      expect(result).toBe(true);
    });

    it('should retrieve communication events for agent', async () => {
      const event: CommunicationScoreEvent = {
        agent_id: 'comm-retrieve-agent',
        commit_hash: 'abc123',
        project_path: '/test/project',
        grade: 2,
        timestamp: new Date()
      };
      await db.putCommunicationEvent(event);
      const events = await db.getCommunicationEvents('comm-retrieve-agent');
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.agent_id).toBe('comm-retrieve-agent');
    });

    it('should limit results when specified', async () => {
      const event: CommunicationScoreEvent = {
        agent_id: 'comm-limit-agent',
        commit_hash: 'abc123',
        project_path: '/test/project',
        grade: 1,
        timestamp: new Date()
      };
      await db.putCommunicationEvent(event);
      await db.putCommunicationEvent({ ...event, commit_hash: 'def456' });
      const events = await db.getCommunicationEvents('comm-limit-agent', 1);
      expect(events.length).toBeLessThanOrEqual(1);
    });

    it('should return empty array when unavailable', async () => {
      await db.close();
      const events = await db.getCommunicationEvents('comm-unavailable');
      expect(events).toEqual([]);
    });
  });

  describe('putRetrospective / getRetrospectives', () => {
    const entry: RetrospectiveEntry = {
      commit: 'abc123',
      timestamp: '2026-02-23T18:00:00Z',
      task: 'Test task',
      agent_grade: 2,
      user_grade: 2,
      score_before: 60,
      score_after: 64,
      agent_note: 'Good work',
      user_note: ''
    };

    it('should store retrospective entry', async () => {
      const result = await db.putRetrospective('retro-store-agent', 'abc123', entry);
      expect(result).toBe(true);
    });

    it('should retrieve retrospective entries for agent', async () => {
      await db.putRetrospective('retro-retrieve-agent', 'abc123', entry);
      const entries = await db.getRetrospectives('retro-retrieve-agent');
      expect(entries.length).toBe(1);
      expect(entries[0]?.commit).toBe('abc123');
      expect(entries[0]?.agent_grade).toBe(2);
    });

    it('should limit retrospective results', async () => {
      await db.putRetrospective('retro-limit-agent', 'abc123', entry);
      await db.putRetrospective('retro-limit-agent', 'def456', { ...entry, commit: 'def456' });
      const entries = await db.getRetrospectives('retro-limit-agent', 1);
      expect(entries.length).toBe(1);
    });

    it('should return false when unavailable', async () => {
      await db.close();
      const result = await db.putRetrospective('retro-unavail', 'abc123', entry);
      expect(result).toBe(false);
    });

    it('should return empty when unavailable', async () => {
      await db.close();
      const entries = await db.getRetrospectives('retro-unavail');
      expect(entries).toEqual([]);
    });
  });

  describe('putActivity / getActivities', () => {
    const entry: ActivityEntry = {
      timestamp: '2026-02-23T18:00:00Z',
      task: 'Write specs',
      actions: 'Analyzed codebase, identified bugs',
      outcome: 'SPECS.md written',
      decisions: 'Phase 1 spec-agent workflow'
    };

    it('should store activity entry', async () => {
      const result = await db.putActivity('activity-store-agent', entry);
      expect(result).toBe(true);
    });

    it('should retrieve activity entries for agent', async () => {
      await db.putActivity('activity-retrieve-agent', entry);
      const entries = await db.getActivities('activity-retrieve-agent');
      expect(entries.length).toBe(1);
      expect(entries[0]?.task).toBe('Write specs');
    });

    it('should limit activity results', async () => {
      await db.putActivity('activity-limit-agent', entry);
      await db.putActivity('activity-limit-agent', { ...entry, timestamp: '2026-02-23T19:00:00Z' });
      const entries = await db.getActivities('activity-limit-agent', 1);
      expect(entries.length).toBe(1);
    });

    it('should return empty when unavailable', async () => {
      await db.close();
      const entries = await db.getActivities('activity-unavail');
      expect(entries).toEqual([]);
    });
  });

  describe('close', () => {
    it('should close database connection', async () => {
      await db.close();
      expect(db.isAvailable).toBe(false);
    });

    it('should be safe to call close twice', async () => {
      await db.close();
      await db.close();
      expect(db.isAvailable).toBe(false);
    });
  });
});

describe('LMDBDatabase filesystem path', () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');

  it('should create parent directory and open LMDB as a file, not a directory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmdb-test-'));
    const dbPath = path.join(tmpDir, 'nested', 'test.lmdb');

    const fsDb = new LMDBDatabase(dbPath);
    try {
      expect(fsDb.isAvailable).toBe(true);

      // Parent directory should exist
      expect(fs.existsSync(path.join(tmpDir, 'nested'))).toBe(true);
      expect(fs.statSync(path.join(tmpDir, 'nested')).isDirectory()).toBe(true);

      // LMDB path should be a file, NOT a directory
      expect(fs.existsSync(dbPath)).toBe(true);
      expect(fs.statSync(dbPath).isDirectory()).toBe(false);

      // Should be able to write and read data
      const agentData = {
        id: 'fs-test-agent',
        name: 'FS Test',
        model: 'test',
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
      await fsDb.putAgent('fs-test-agent', agentData);
      const retrieved = await fsDb.getAgent('fs-test-agent');
      expect(retrieved?.id).toBe('fs-test-agent');
    } finally {
      await fsDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
