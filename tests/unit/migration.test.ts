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

  it('should migrate agent entries and remove old directory', async () => {
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

    const oldRoot = join(tempDir, '~');
    expect(existsSync(oldRoot)).toBe(true);

    const result = await migrateFromProjectDatabase(tempDir, targetDb);

    expect(result.entriesMigrated).toBe(1);
    expect(result.entriesSkipped).toBe(0);
    expect(result.errors).toEqual([]);

    const stored = await targetDb.getAgent('migrate-agent-1');
    expect(stored?.id).toBe('migrate-agent-1');
    expect(stored?.skill_points).toBe(2);

    expect(existsSync(oldRoot)).toBe(false);
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

    expect(existsSync(join(tempDir, '~'))).toBe(false);
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

    expect(existsSync(join(tempDir, '~'))).toBe(false);
  });

  it('should be idempotent -- second run is a no-op because old DB was removed', async () => {
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

    expect(existsSync(join(tempDir, '~'))).toBe(false);

    const result2 = await migrateFromProjectDatabase(tempDir, targetDb);
    expect(result2.entriesMigrated).toBe(0);
    expect(result2.entriesSkipped).toBe(0);
    expect(result2.errors).toEqual([]);
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

    expect(existsSync(join(tempDir, '~'))).toBe(false);
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

  it('should not remove old directory when target database is unavailable', async () => {
    const agent: AgentData = {
      id: 'no-cleanup-agent',
      name: 'NoCleanup',
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

    createSourceDb({ 'agent:no-cleanup-agent': agent });
    targetDb.setAvailable(false);

    const oldRoot = join(tempDir, '~');
    expect(existsSync(oldRoot)).toBe(true);

    await migrateFromProjectDatabase(tempDir, targetDb);

    expect(existsSync(oldRoot)).toBe(true);
  });
});

describe('detectOldDatabase', () => {
  const { detectOldDatabase } = require('../../src/migration');
  let targetDb: MockDatabase;
  let tempDir: string;

  beforeEach(() => {
    targetDb = new MockDatabase();
    tempDir = join(tmpdir(), `detect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should return tildeExists=false when no ./~ directory', async () => {
    const result = await detectOldDatabase(tempDir, targetDb);

    expect(result.tildeExists).toBe(false);
    expect(result.hasLmdb).toBe(false);
    expect(result.alreadyMigrated).toBe(false);
  });

  it('should return hasLmdb=true when LMDB file exists in ./~', async () => {
    const sourceDbPath = join(tempDir, '~', '.config', 'opencode', 'agent-tracker.lmdb');
    mkdirSync(dirname(sourceDbPath), { recursive: true });
    const db = open({ path: sourceDbPath });
    db.close();

    const result = await detectOldDatabase(tempDir, targetDb);

    expect(result.tildeExists).toBe(true);
    expect(result.hasLmdb).toBe(true);
    expect(result.alreadyMigrated).toBe(false);
  });

  it('should return hasLmdb=false when ./~ exists but no LMDB file', async () => {
    mkdirSync(join(tempDir, '~', 'something'), { recursive: true });

    const result = await detectOldDatabase(tempDir, targetDb);

    expect(result.tildeExists).toBe(true);
    expect(result.hasLmdb).toBe(false);
    expect(result.alreadyMigrated).toBe(false);
  });

  it('should return hasLmdb=false when LMDB path is a directory', async () => {
    const lmdbDir = join(tempDir, '~', '.config', 'opencode', 'agent-tracker.lmdb');
    mkdirSync(lmdbDir, { recursive: true });

    const result = await detectOldDatabase(tempDir, targetDb);

    expect(result.tildeExists).toBe(true);
    expect(result.hasLmdb).toBe(false);
    expect(result.alreadyMigrated).toBe(false);
  });

  it('should return alreadyMigrated=true when migration record exists', async () => {
    mkdirSync(join(tempDir, '~'), { recursive: true });
    await targetDb.putMigration(tempDir, {
      sourcePath: tempDir,
      version: '0.0.1',
      timestamp: new Date(),
      entriesMigrated: 3
    });

    const result = await detectOldDatabase(tempDir, targetDb);

    expect(result.tildeExists).toBe(true);
    expect(result.alreadyMigrated).toBe(true);
  });

  it('should return alreadyMigrated=false when db is unavailable', async () => {
    mkdirSync(join(tempDir, '~'), { recursive: true });
    targetDb.setAvailable(false);

    const result = await detectOldDatabase(tempDir, targetDb);

    expect(result.tildeExists).toBe(true);
    expect(result.alreadyMigrated).toBe(false);
  });
});

describe('migration record storage', () => {
  let targetDb: MockDatabase;
  let tempDir: string;

  beforeEach(() => {
    targetDb = new MockDatabase();
    tempDir = join(tmpdir(), `record-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should store migration record after successful migration', async () => {
    const sourceDbPath = join(tempDir, '~', '.config', 'opencode', 'agent-tracker.lmdb');
    mkdirSync(dirname(sourceDbPath), { recursive: true });
    const db = open({ path: sourceDbPath });
    db.putSync('agent:record-test-agent', {
      id: 'record-test-agent',
      name: 'Test',
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
    });
    db.close();

    await migrateFromProjectDatabase(tempDir, targetDb);

    const record = await targetDb.getMigration(tempDir);
    expect(record).not.toBeNull();
    expect(record?.sourcePath).toBe(tempDir);
    expect(record?.entriesMigrated).toBe(1);
    expect(record?.version).toBeDefined();
    expect(record?.timestamp).toBeDefined();
  });

  it('should not store migration record when migration fails', async () => {
    targetDb.setAvailable(false);

    await migrateFromProjectDatabase(tempDir, targetDb);

    targetDb.setAvailable(true);
    const record = await targetDb.getMigration(tempDir);
    expect(record).toBeNull();
  });
});
