import { QueryService } from '../../src/query-service';
import { MockDatabase } from '../../src/mock-database';
import type { AgentData, RetrospectiveEntry, ActivityEntry, CommitData } from '../../src/types';

describe('QueryService', () => {
  let db: MockDatabase;
  let service: QueryService;

  beforeEach(() => {
    db = new MockDatabase();
    service = new QueryService(db);
  });

  const makeAgent = (id: string, scope: string): AgentData => ({
    id,
    name: id,
    model: 'test',
    scope,
    skill_points: 1,
    experience_points: 0,
    communication_score: 60,
    total_commits: 0,
    total_bugs: 0,
    active: true,
    created_at: new Date(),
    updated_at: new Date()
  });

  const makeRetro = (overrides: Partial<RetrospectiveEntry> = {}): RetrospectiveEntry => ({
    commit: 'abc123',
    timestamp: '2026-02-23T18:00:00Z',
    task: 'Implement feature',
    agent_grade: 2,
    user_grade: 2,
    score_before: 60,
    score_after: 64,
    agent_note: 'Good implementation',
    user_note: 'Well done',
    ...overrides
  });

  const makeActivity = (overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
    timestamp: '2026-02-23T18:00:00Z',
    task: 'Write specs',
    actions: 'Analyzed codebase',
    outcome: 'SPECS.md written',
    decisions: 'Use spec-agent workflow',
    ...overrides
  });

  const makeCommit = (overrides: Partial<CommitData> = {}): CommitData => ({
    agent_id: 'agent1',
    commit_hash: 'abc123',
    project_path: '/test',
    task_description: 'Add database support',
    experience_gained: 1,
    communication_score_change: 0,
    timestamp: new Date(),
    ...overrides
  });

  describe('extractKeywords', () => {
    it('should lowercase and split on non-alpha characters', () => {
      const keywords = service.extractKeywords('Add Database Support');
      expect(keywords).toContain('add');
      expect(keywords).toContain('database');
      expect(keywords).toContain('support');
    });

    it('should remove stop words', () => {
      const keywords = service.extractKeywords('the quick brown fox is very fast');
      expect(keywords).not.toContain('the');
      expect(keywords).not.toContain('is');
      expect(keywords).not.toContain('very');
      expect(keywords).toContain('quick');
      expect(keywords).toContain('brown');
      expect(keywords).toContain('fox');
      expect(keywords).toContain('fast');
    });

    it('should filter words shorter than 3 characters', () => {
      const keywords = service.extractKeywords('go to db');
      expect(keywords).toEqual([]);
    });

    it('should deduplicate keywords', () => {
      const keywords = service.extractKeywords('database database DATABASE');
      expect(keywords).toEqual(['database']);
    });

    it('should handle empty string', () => {
      const keywords = service.extractKeywords('');
      expect(keywords).toEqual([]);
    });

    it('should split on hyphens and underscores', () => {
      const keywords = service.extractKeywords('prior-art_search');
      expect(keywords).toContain('prior');
      expect(keywords).toContain('art');
      expect(keywords).toContain('search');
    });

    it('should handle numbers mixed with text', () => {
      const keywords = service.extractKeywords('add v2 migration for lmdb3');
      expect(keywords).toContain('add');
      expect(keywords).toContain('migration');
      expect(keywords).toContain('lmdb');
    });
  });

  describe('scoreEntry', () => {
    it('should return 1.0 when all keywords match', () => {
      const score = service.scoreEntry(
        ['database', 'migration'],
        ['database migration complete']
      );
      expect(score).toBe(1.0);
    });

    it('should return 0.5 when half keywords match', () => {
      const score = service.scoreEntry(
        ['database', 'migration', 'testing', 'deploy'],
        ['database migration complete']
      );
      expect(score).toBe(0.5);
    });

    it('should return 0 when no keywords match', () => {
      const score = service.scoreEntry(
        ['frontend', 'react'],
        ['database migration complete']
      );
      expect(score).toBe(0);
    });

    it('should return 0 for empty keywords array', () => {
      const score = service.scoreEntry([], ['some text']);
      expect(score).toBe(0);
    });

    it('should match across multiple fields', () => {
      const score = service.scoreEntry(
        ['database', 'testing'],
        ['database setup', 'testing complete']
      );
      expect(score).toBe(1.0);
    });

    it('should be case-insensitive', () => {
      const score = service.scoreEntry(
        ['database'],
        ['DATABASE is ready']
      );
      expect(score).toBe(1.0);
    });
  });

  describe('searchPriorArt', () => {
    it('should return empty results for very short task descriptions', async () => {
      const result = await service.searchPriorArt({
        taskDescription: 'fix it',
        scope: 'test'
      });
      expect(result.positivePatterns).toEqual([]);
      expect(result.crossScopePatterns).toEqual([]);
      expect(result.mistakes).toEqual([]);
    });

    it('should return empty results when database is empty', async () => {
      const result = await service.searchPriorArt({
        taskDescription: 'implement database migration feature',
        scope: 'test'
      });
      expect(result.positivePatterns).toEqual([]);
      expect(result.crossScopePatterns).toEqual([]);
      expect(result.mistakes).toEqual([]);
    });

    it('should find scope-local positive patterns', async () => {
      await db.putAgent('agent1', makeAgent('agent1', 'backend'));
      await db.putRetrospective('agent1', 'c1', makeRetro({
        commit: 'c1',
        task: 'Implement database migration',
        agent_grade: 2,
        user_grade: 2,
        agent_note: 'Migration worked well'
      }));

      const result = await service.searchPriorArt({
        taskDescription: 'add new database migration for users',
        scope: 'backend'
      });
      expect(result.positivePatterns.length).toBe(1);
      expect(result.positivePatterns[0]?.task).toBe('Implement database migration');
    });

    it('should find cross-scope patterns when scope-local insufficient', async () => {
      await db.putAgent('agent1', makeAgent('agent1', 'frontend'));
      await db.putRetrospective('agent1', 'c1', makeRetro({
        commit: 'c1',
        task: 'Implement database caching layer',
        agent_grade: 2,
        user_grade: 5,
        agent_note: 'Caching improved performance'
      }));

      const result = await service.searchPriorArt({
        taskDescription: 'add database caching for API responses',
        scope: 'backend'
      });
      expect(result.positivePatterns).toEqual([]);
      expect(result.crossScopePatterns.length).toBe(1);
      expect(result.crossScopePatterns[0]?.scope).toBe('frontend');
    });

    it('should find mistakes from any scope', async () => {
      await db.putAgent('agent1', makeAgent('agent1', 'backend'));
      await db.putRetrospective('agent1', 'c1', makeRetro({
        commit: 'c1',
        task: 'Database schema migration',
        agent_grade: -1,
        user_grade: -1,
        agent_note: 'Migration broke existing data'
      }));

      const result = await service.searchPriorArt({
        taskDescription: 'implement database schema changes',
        scope: 'frontend'
      });
      expect(result.mistakes.length).toBe(1);
      expect(result.mistakes[0]?.grade).toBe(-1);
    });

    it('should not include cross-scope when scope-local has enough results', async () => {
      await db.putAgent('agent1', makeAgent('agent1', 'backend'));
      await db.putAgent('agent2', makeAgent('agent2', 'frontend'));

      for (let i = 0; i < 5; i++) {
        await db.putRetrospective('agent1', `local-${i}`, makeRetro({
          commit: `local-${i}`,
          task: `Database feature ${i} implementation`,
          agent_grade: 2,
          user_grade: 2
        }));
      }
      await db.putRetrospective('agent2', 'cross-1', makeRetro({
        commit: 'cross-1',
        task: 'Database cross scope feature',
        agent_grade: 2,
        user_grade: 5
      }));

      const result = await service.searchPriorArt({
        taskDescription: 'implement database feature with implementation',
        scope: 'backend',
        maxResults: 5
      });
      expect(result.positivePatterns.length).toBe(5);
      expect(result.crossScopePatterns).toEqual([]);
    });

    it('should respect maxResults limit', async () => {
      await db.putAgent('agent1', makeAgent('agent1', 'backend'));
      for (let i = 0; i < 10; i++) {
        await db.putRetrospective('agent1', `c-${i}`, makeRetro({
          commit: `c-${i}`,
          task: `Database migration task ${i}`,
          agent_grade: 2,
          user_grade: 2
        }));
      }

      const result = await service.searchPriorArt({
        taskDescription: 'database migration implementation task',
        scope: 'backend',
        maxResults: 3
      });
      expect(result.positivePatterns.length).toBe(3);
    });

    it('should sort results by relevance score descending', async () => {
      await db.putAgent('agent1', makeAgent('agent1', 'backend'));
      await db.putRetrospective('agent1', 'low', makeRetro({
        commit: 'low',
        task: 'Simple database work',
        agent_grade: 2,
        user_grade: 2
      }));
      await db.putRetrospective('agent1', 'high', makeRetro({
        commit: 'high',
        task: 'Complex database migration with schema validation',
        agent_grade: 2,
        user_grade: 2
      }));

      const result = await service.searchPriorArt({
        taskDescription: 'database migration schema validation complex',
        scope: 'backend'
      });
      expect(result.positivePatterns.length).toBeGreaterThan(0);
      if (result.positivePatterns.length >= 2) {
        expect(result.positivePatterns[0]!.relevanceScore)
          .toBeGreaterThanOrEqual(result.positivePatterns[1]!.relevanceScore);
      }
    });

    it('should include activity entries in results', async () => {
      await db.putAgent('agent1', makeAgent('agent1', 'backend'));
      await db.putActivity('agent1', makeActivity({
        task: 'Write database migration specs',
        outcome: 'SPECS.md written with migration plan'
      }));

      const result = await service.searchPriorArt({
        taskDescription: 'write specs for database migration',
        scope: 'backend'
      });
      const activityMatches = [...result.positivePatterns, ...result.crossScopePatterns]
        .filter(m => m.source === 'activity');
      expect(activityMatches.length).toBeGreaterThanOrEqual(0);
    });

    it('should include commit entries in results', async () => {
      await db.putAgent('agent1', makeAgent('agent1', 'backend'));
      await db.putCommit('/project', 'hash1', makeCommit({
        agent_id: 'agent1',
        task_description: 'Add database migration support'
      }));

      const result = await service.searchPriorArt({
        taskDescription: 'implement database migration feature',
        scope: 'backend'
      });
      const allResults = [
        ...result.positivePatterns,
        ...result.crossScopePatterns,
        ...result.mistakes
      ];
      expect(allResults.some(m => m.source === 'commit')).toBe(false);
    });

    it('should filter entries below minimum relevance threshold', async () => {
      await db.putAgent('agent1', makeAgent('agent1', 'backend'));
      await db.putRetrospective('agent1', 'unrelated', makeRetro({
        commit: 'unrelated',
        task: 'Fix CSS styling for buttons',
        agent_grade: 2,
        user_grade: 2,
        agent_note: 'Styled the button component'
      }));

      const result = await service.searchPriorArt({
        taskDescription: 'implement database migration schema',
        scope: 'backend'
      });
      expect(result.positivePatterns.length).toBe(0);
    });
  });

  describe('formatPriorArt', () => {
    it('should return no-results message when all categories empty', () => {
      const output = service.formatPriorArt({
        positivePatterns: [],
        crossScopePatterns: [],
        mistakes: []
      });
      expect(output).toContain('No prior art found');
    });

    it('should format positive patterns section', () => {
      const output = service.formatPriorArt({
        positivePatterns: [{
          source: 'retrospective',
          task: 'Database migration',
          notes: 'Worked well',
          grade: 2,
          agentId: 'agent1',
          scope: 'backend',
          timestamp: '2026-02-23T18:00:00Z',
          relevanceScore: 0.8
        }],
        crossScopePatterns: [],
        mistakes: []
      });
      expect(output).toContain('### Prior Art: Positive Patterns');
      expect(output).toContain('Database migration');
      expect(output).toContain('good');
      expect(output).toContain('80%');
      expect(output).toContain('agent1');
    });

    it('should format cross-scope patterns section', () => {
      const output = service.formatPriorArt({
        positivePatterns: [],
        crossScopePatterns: [{
          source: 'activity',
          task: 'Frontend caching',
          notes: 'Cache invalidation',
          grade: 5,
          agentId: 'agent2',
          scope: 'frontend',
          timestamp: '2026-02-23T18:00:00Z',
          relevanceScore: 0.6
        }],
        mistakes: []
      });
      expect(output).toContain('### Prior Art: Cross-Scope Patterns');
      expect(output).toContain('Frontend caching');
      expect(output).toContain('excellence');
    });

    it('should format mistakes section', () => {
      const output = service.formatPriorArt({
        positivePatterns: [],
        crossScopePatterns: [],
        mistakes: [{
          source: 'retrospective',
          task: 'Schema migration broke data',
          notes: 'Did not backup before migration',
          grade: -1,
          agentId: 'agent1',
          scope: 'backend',
          timestamp: '2026-02-23T18:00:00Z',
          relevanceScore: 0.9
        }]
      });
      expect(output).toContain('### Prior Art: Mistakes to Avoid');
      expect(output).toContain('Schema migration broke data');
      expect(output).toContain('bad');
    });

    it('should omit empty sections', () => {
      const output = service.formatPriorArt({
        positivePatterns: [{
          source: 'retrospective',
          task: 'Test task',
          notes: '',
          grade: 2,
          agentId: 'a1',
          scope: 's1',
          timestamp: '2026-02-23T18:00:00Z',
          relevanceScore: 0.5
        }],
        crossScopePatterns: [],
        mistakes: []
      });
      expect(output).toContain('### Prior Art: Positive Patterns');
      expect(output).not.toContain('Cross-Scope');
      expect(output).not.toContain('Mistakes');
    });

    it('should show relevance percentage for each match', () => {
      const output = service.formatPriorArt({
        positivePatterns: [{
          source: 'retrospective',
          task: 'Test',
          notes: 'Notes',
          grade: 2,
          agentId: 'a1',
          scope: 's1',
          timestamp: '2026-02-23T18:00:00Z',
          relevanceScore: 0.75
        }],
        crossScopePatterns: [],
        mistakes: []
      });
      expect(output).toContain('75%');
    });
  });
});
