import { migrateFromProjectDatabase } from '../../src/migration';
import { MockDatabase } from '../../src/mock-database';
import { open } from 'lmdb';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import type { AgentData, CommitData, CommunicationScoreEvent } from '../../src/types';

describe('migrateFromProjectDatabase', () => {
  let targetDb: MockDatabase;
  let tempDir: string;
  let sourceDbPath: string;

  beforeEach(() => {
    targetDb = new MockDatabase();
    tempDir = join(tmpdir(), `migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    sourceDbPath = join(tempDir, '~', '.config', 'opencode', 'agent-tracker.lmdb');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * Creates a source database with old-format prefix-based keys.
   * LMDB creates the db file itself; we only create the parent directory.
   */
  function createSourceDb(entries: Record<string, unknown>): void {
    mkdirSync(dirname(sourceDbPath), { recursive: true });
    const db = open({ path: sourceDbPath });
    for (const [key, value] of Object.entries(entries)) {
      db.putSync(key, value);
    }
    db.close();
  }

  it('should be a no-op when source database does not exist', async () => {
    const result = await migrateFromProjectDatabase(tempDir, targetDb);

    expect(result.entriesMigrated).toBe(0);
    expect(result.entriesSkipped).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('should migrate agent entries', async () => {
    const agentData: AgentData = {
      id: 'migrate-agent-1',
      name: 'Migrated Agent',
      model: 'test',
      scope: 'test',
      skill_points: 2,
      experience_points: 100,
      communication_score: 75,
      total_commits: 5,
      total_bugs: 0,
      active: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-02-01')
    };

    createSourceDb({ 'agent:migrate-agent-1': agentData });

    const result = await migrateFromProjectDatabase(tempDir, targetDb);

    expect(result.entriesMigrated).toBe(1);
    expect(result.entriesSkipped).toBe(0);
    expect(result.errors).toEqual([]);

    const stored = await targetDb.getAgent('migrate-agent-1');
    expect(stored?.id).toBe('migrate-agent-1');
    expect(stored?.skill_points).toBe(2);
  });

  it('should migrate commit entries', async () => {
    const commitData: CommitData = {
      agent_id: 'agent-1',
      commit_hash: 'abc123',
      project_path: '/project',
      task_description: 'Test task',
      experience_gained: 5,
      communication_score_change: 2,
      timestamp: new Date('2026-02-01')
    };

    createSourceDb({ 'commit:/project:abc123': commitData });

    const result = await migrateFromProjectDatabase(tempDir, targetDb);

    expect(result.entriesMigrated).toBe(1);
    const stored = await targetDb.getCommit('/project', 'abc123');
    expect(stored?.task_description).toBe('Test task');
  });

  it('should migrate communication events', async () => {
    const event: CommunicationScoreEvent = {
      agent_id: 'agent-1',
      commit_hash: 'abc123',
      project_path: '/project',
      grade: 2,
      timestamp: new Date('2026-02-01')
    };

    createSourceDb({ 'communication:event-1': event });

    const result = await migrateFromProjectDatabase(tempDir, targetDb);

    expect(result.entriesMigrated).toBe(1);
    const events = await targetDb.getCommunicationEvents('agent-1');
    expect(events.length).toBe(1);
    expect(events[0]?.grade).toBe(2);
  });

  it('should migrate multiple entry types in one pass', async () => {
    const agent: AgentData = {
      id: 'multi-agent',
      name: 'Multi',
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

    const commit: CommitData = {
      agent_id: 'multi-agent',
      commit_hash: 'def456',
      project_path: '/proj',
      task_description: 'Multi task',
      experience_gained: 5,
      communication_score_change: 0,
      timestamp: new Date()
    };

    const event: CommunicationScoreEvent = {
      agent_id: 'multi-agent',
      commit_hash: 'def456',
      project_path: '/proj',
      grade: 1,
      timestamp: new Date()
    };

    createSourceDb({
      'agent:multi-agent': agent,
      'commit:/proj:def456': commit,
      'communication:ev-1': event
    });

    const result = await migrateFromProjectDatabase(tempDir, targetDb);

    expect(result.entriesMigrated).toBe(3);
    expect(result.entriesSkipped).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('should be idempotent -- second run skips existing entries', async () => {
    const agent: AgentData = {
      id: 'idempotent-agent',
      name: 'Idempotent',
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

    createSourceDb({
      'agent:idempotent-agent': agent,
      'commit:/proj:abc123': {
        agent_id: 'idempotent-agent',
        commit_hash: 'abc123',
        project_path: '/proj',
        task_description: 'Task',
        experience_gained: 5,
        communication_score_change: 0,
        timestamp: new Date()
      }
    });

    const result1 = await migrateFromProjectDatabase(tempDir, targetDb);
    expect(result1.entriesMigrated).toBe(2);
    expect(result1.entriesSkipped).toBe(0);

    const result2 = await migrateFromProjectDatabase(tempDir, targetDb);
    expect(result2.entriesMigrated).toBe(0);
    expect(result2.entriesSkipped).toBe(2);
  });

  it('should skip agents that already exist in target', async () => {
    const existingAgent: AgentData = {
      id: 'existing-agent',
      name: 'Existing',
      model: 'test',
      scope: 'test',
      skill_points: 5,
      experience_points: 999,
      communication_score: 100,
      total_commits: 50,
      total_bugs: 0,
      active: true,
      created_at: new Date(),
      updated_at: new Date()
    };

    await targetDb.putAgent('existing-agent', existingAgent);

    const sourceAgent: AgentData = {
      id: 'existing-agent',
      name: 'Old Version',
      model: 'old',
      scope: 'old',
      skill_points: 1,
      experience_points: 0,
      communication_score: 60,
      total_commits: 0,
      total_bugs: 0,
      active: true,
      created_at: new Date(),
      updated_at: new Date()
    };

    createSourceDb({ 'agent:existing-agent': sourceAgent });

    const result = await migrateFromProjectDatabase(tempDir, targetDb);

    expect(result.entriesSkipped).toBe(1);
    expect(result.entriesMigrated).toBe(0);

    const agent = await targetDb.getAgent('existing-agent');
    expect(agent?.skill_points).toBe(5);
    expect(agent?.name).toBe('Existing');
  });

  it('should report error for unknown key prefixes', async () => {
    createSourceDb({ 'unknown:key-1': { some: 'data' } });

    const result = await migrateFromProjectDatabase(tempDir, targetDb);

    expect(result.entriesMigrated).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('Unknown key prefix');
  });

  it('should report error for invalid commit key format', async () => {
    createSourceDb({ 'commit:nocolon': { some: 'data' } });

    const result = await migrateFromProjectDatabase(tempDir, targetDb);

    expect(result.entriesMigrated).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('Invalid commit key format');
  });

  it('should return error when target database is unavailable', async () => {
    targetDb.setAvailable(false);

    const result = await migrateFromProjectDatabase(tempDir, targetDb);

    expect(result.entriesMigrated).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('Target database is not available');
  });


});
