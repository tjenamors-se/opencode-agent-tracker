import type { Database } from './database.js'
import type { PriorArtQuery, PriorArtResult, PatternMatch, Grade } from './types.js'
import { GRADE_LABELS } from './types.js'

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'not',
  'no', 'nor', 'so', 'if', 'then', 'than', 'too', 'very', 'just',
  'about', 'above', 'after', 'again', 'all', 'also', 'any', 'because',
  'before', 'between', 'both', 'each', 'few', 'get', 'got', 'her',
  'here', 'him', 'his', 'how', 'into', 'its', 'let', 'more', 'most',
  'new', 'now', 'old', 'only', 'other', 'our', 'out', 'own', 'same',
  'she', 'some', 'such', 'that', 'their', 'them', 'these', 'they',
  'this', 'those', 'through', 'under', 'until', 'upon', 'use', 'used',
  'using', 'what', 'when', 'where', 'which', 'while', 'who', 'whom',
  'why', 'you', 'your'
])

/**
 * Searches LMDB database for prior art relevant to a given task.
 * Uses keyword matching to find positive patterns, cross-scope patterns,
 * and mistakes from historical retrospectives, activities, and commits.
 */
export class QueryService {
  constructor(private db: Database) {}

  /**
   * Extracts searchable keywords from text.
   * Lowercases, splits on non-alpha characters, removes stop words,
   * filters words shorter than 3 characters, and deduplicates.
   */
  extractKeywords(text: string): string[] {
    const words = text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(word => word.length >= 3 && !STOP_WORDS.has(word))

    return [...new Set(words)]
  }

  /**
   * Scores an entry by counting keyword matches across its text fields.
   * @returns Relevance score from 0.0 to 1.0 (matched / total keywords)
   */
  scoreEntry(keywords: string[], fields: string[]): number {
    if (keywords.length === 0) return 0

    const combined = fields.join(' ').toLowerCase()
    let matched = 0

    for (const keyword of keywords) {
      if (combined.includes(keyword)) {
        matched++
      }
    }

    return matched / keywords.length
  }

  /**
   * Searches the database for prior art matching the query.
   * Performs three searches: scope-local positives, cross-scope positives, mistakes.
   */
  async searchPriorArt(query: PriorArtQuery): Promise<PriorArtResult> {
    const keywords = this.extractKeywords(query.taskDescription)
    const maxResults = query.maxResults ?? 5
    const minRelevance = 0.1

    if (keywords.length < 2) {
      return { positivePatterns: [], crossScopePatterns: [], mistakes: [] }
    }

    const [allRetros, allActivities, allCommits] = await Promise.all([
      this.db.getAllRetrospectives(1000),
      this.db.getAllActivities(1000),
      this.db.getAllCommits(1000)
    ])

    const agentScopes = await this.resolveAgentScopes(
      new Set([
        ...allRetros.map(r => r.agent_id),
        ...allActivities.map(a => a.agent_id),
        ...allCommits.map(c => c.agent_id)
      ])
    )

    const allMatches: PatternMatch[] = []

    for (const retro of allRetros) {
      const fields = [retro.task, retro.agent_note, retro.user_note]
      const score = this.scoreEntry(keywords, fields)
      if (score >= minRelevance) {
        const agentScope = agentScopes.get(retro.agent_id) ?? 'unknown'
        allMatches.push({
          source: 'retrospective',
          task: retro.task,
          notes: [retro.agent_note, retro.user_note].filter(Boolean).join(' | '),
          grade: this.averageGrade(retro.agent_grade, retro.user_grade),
          agentId: retro.agent_id,
          scope: agentScope,
          timestamp: retro.timestamp,
          relevanceScore: score
        })
      }
    }

    for (const activity of allActivities) {
      const fields = [activity.task, activity.actions, activity.outcome, activity.decisions]
      const score = this.scoreEntry(keywords, fields)
      if (score >= minRelevance) {
        const agentScope = agentScopes.get(activity.agent_id) ?? 'unknown'
        allMatches.push({
          source: 'activity',
          task: activity.task,
          notes: [activity.outcome, activity.decisions].filter(Boolean).join(' | '),
          agentId: activity.agent_id,
          scope: agentScope,
          timestamp: activity.timestamp,
          relevanceScore: score
        })
      }
    }

    for (const commit of allCommits) {
      const fields = [commit.task_description]
      const score = this.scoreEntry(keywords, fields)
      if (score >= minRelevance) {
        const agentScope = agentScopes.get(commit.agent_id) ?? 'unknown'
        allMatches.push({
          source: 'commit',
          task: commit.task_description,
          notes: '',
          agentId: commit.agent_id,
          scope: agentScope,
          timestamp: commit.timestamp instanceof Date ? commit.timestamp.toISOString() : String(commit.timestamp),
          relevanceScore: score
        })
      }
    }

    const positivePatterns = allMatches
      .filter(m => m.scope === query.scope && this.isPositiveGrade(m.grade))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxResults)

    const positiveIds = new Set(positivePatterns.map(p => `${p.source}:${p.task}:${p.timestamp}`))

    let crossScopePatterns: PatternMatch[] = []
    if (positivePatterns.length < maxResults) {
      crossScopePatterns = allMatches
        .filter(m =>
          m.scope !== query.scope &&
          this.isPositiveGrade(m.grade) &&
          !positiveIds.has(`${m.source}:${m.task}:${m.timestamp}`)
        )
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, maxResults)
    }

    const mistakes = allMatches
      .filter(m => m.grade === -1)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxResults)

    return { positivePatterns, crossScopePatterns, mistakes }
  }

  /**
   * Formats prior art results as markdown sections.
   */
  formatPriorArt(result: PriorArtResult): string {
    const sections: string[] = []

    if (result.positivePatterns.length === 0 &&
        result.crossScopePatterns.length === 0 &&
        result.mistakes.length === 0) {
      return '### Prior Art\n\nNo prior art found in the database.\n'
    }

    if (result.positivePatterns.length > 0) {
      sections.push('### Prior Art: Positive Patterns\n')
      for (const match of result.positivePatterns) {
        sections.push(this.formatMatch(match))
      }
    }

    if (result.crossScopePatterns.length > 0) {
      sections.push('### Prior Art: Cross-Scope Patterns\n')
      for (const match of result.crossScopePatterns) {
        sections.push(this.formatMatch(match))
      }
    }

    if (result.mistakes.length > 0) {
      sections.push('### Prior Art: Mistakes to Avoid\n')
      for (const match of result.mistakes) {
        sections.push(this.formatMatch(match))
      }
    }

    return sections.join('\n')
  }

  /**
   * Formats a single pattern match as a markdown list item.
   */
  private formatMatch(match: PatternMatch): string {
    const gradeLabel = match.grade !== undefined ? GRADE_LABELS[match.grade] ?? 'unknown' : 'n/a'
    const relevancePct = Math.round(match.relevanceScore * 100)
    const lines = [
      `- **${match.task}** (${match.source}, ${gradeLabel}, ${relevancePct}% match)`,
      `  Agent: ${match.agentId} | Scope: ${match.scope}`
    ]
    if (match.notes) {
      lines.push(`  Notes: ${match.notes}`)
    }
    return lines.join('\n')
  }

  /**
   * Resolves agent IDs to their scopes by looking up agent data.
   */
  private async resolveAgentScopes(agentIds: Set<string>): Promise<Map<string, string>> {
    const scopes = new Map<string, string>()
    for (const id of agentIds) {
      const agent = await this.db.getAgent(id)
      scopes.set(id, agent?.scope ?? 'unknown')
    }
    return scopes
  }

  /**
   * Averages two grades, returning the lower of the two.
   * For pattern matching, the user grade is ground truth.
   */
  private averageGrade(agentGrade: Grade, userGrade: Grade): Grade {
    return Math.min(agentGrade, userGrade) as Grade
  }

  /**
   * Checks if a grade indicates positive work (good or excellence).
   */
  private isPositiveGrade(grade: Grade | undefined): boolean {
    return grade === 2 || grade === 5
  }
}
