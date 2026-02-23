import type { Database } from './database.js'
import type { WriteBuffer } from './write-buffer.js'
import type { AgentData, CommitData, CommunicationScoreEvent, Grade, AgentStatus, RetrospectiveEntry, ActivityEntry, FlushResult } from './types.js'

export class TrackingService {
  private agentCache: Map<string, AgentData> = new Map()

  constructor(
    private db: Database,
    private writeBuffer: WriteBuffer,
    private client: any
  ) {}

  /**
   * Reads agent from cache or database. Reads are free (memory-mapped).
   */
  private async getOrReadAgent(agentId: string): Promise<AgentData | null> {
    const cached = this.agentCache.get(agentId)
    if (cached) return cached

    const agent = await this.db.getAgent(agentId)
    if (agent) {
      const clone = { ...agent }
      this.agentCache.set(agentId, clone)
      return clone
    }
    return agent
  }

  /**
   * Mutates agent in memory and buffers for later flush.
   */
  private bufferAgentUpdate(agent: AgentData): void {
    agent.updated_at = new Date()
    this.agentCache.set(agent.id, agent)
    this.writeBuffer.bufferAgent(agent.id, agent)
  }

  /**
   * Extracts agent ID from any hook input, command event, or session object.
   */
  private extractAgentId(source: any): string | null {
    return source?.agentId || source?.agent?.id || null
  }

  /**
   * Fire-and-forget log call. Never throws.
   */
  private safeLog(body: Record<string, unknown>): void {
    try {
      this.client?.app?.log({ body })?.catch?.(() => {})
    } catch (_error) {
      // Never crash the host
    }
  }

  /**
   * Fire-and-forget toast call. Never throws.
   */
  private async safeToast(message: string, variant: string): Promise<void> {
    try {
      await this.client?.tui?.toast?.show({ message, variant })
    } catch (_error) {
      // Never crash the host
    }
  }

  async trackToolUsage(input: any, output: any): Promise<void> {
    if (!this.db.isAvailable) return

    const agentId = this.extractAgentId(input)
    if (!agentId) return

    if (output.success) {
      const agent = await this.getOrReadAgent(agentId)
      if (agent) {
        agent.experience_points += 1
        this.bufferAgentUpdate(agent)
      }
    }

    this.safeLog({ message: 'Tool usage tracked', agentId })
  }

  async trackCommandCompletion(event: any): Promise<void> {
    if (!this.db.isAvailable) return

    const agentId = this.extractAgentId(event)
    if (!agentId) return

    if (event.success) {
      const agent = await this.getOrReadAgent(agentId)
      if (agent) {
        agent.experience_points += 2
        this.bufferAgentUpdate(agent)
      }
    }
  }

  async commitCompleted(agentId: string, commitHash: string, projectPath: string, taskDescription: string): Promise<void> {
    if (!this.db.isAvailable) return

    const agent = await this.getOrReadAgent(agentId)
    if (!agent) return

    const commitData: CommitData = {
      agent_id: agentId,
      commit_hash: commitHash,
      project_path: projectPath,
      task_description: taskDescription,
      experience_gained: 5,
      communication_score_change: 0,
      timestamp: new Date()
    }

    this.writeBuffer.bufferCommit(projectPath, commitHash, commitData)

    agent.experience_points += commitData.experience_gained
    agent.total_commits += 1

    const neededForNextLevel = 10000 * agent.skill_points
    if (agent.experience_points >= neededForNextLevel) {
      agent.skill_points += 1
      agent.experience_points = 0

      await this.safeToast(
        `Agent ${agentId} leveled up to SP ${agent.skill_points}!`,
        'success'
      )
    }

    this.bufferAgentUpdate(agent)

    this.safeLog({ message: 'Commit tracked', commitHash })
  }

  async recordCommunicationScore(agentId: string, commitHash: string, projectPath: string, grade: Grade): Promise<void> {
    if (!this.db.isAvailable) return

    const event: CommunicationScoreEvent = {
      agent_id: agentId,
      commit_hash: commitHash,
      project_path: projectPath,
      grade,
      timestamp: new Date()
    }

    this.writeBuffer.bufferCommunicationEvent(event)

    const agent = await this.getOrReadAgent(agentId)
    if (agent) {
      agent.communication_score = Math.max(0, agent.communication_score + grade)
      this.bufferAgentUpdate(agent)
    }

    this.safeLog({ message: 'Communication score recorded', agentId, grade })
  }

  async initializeSessionTracking(session: any): Promise<void> {
    if (!this.db.isAvailable) return

    const agentId = this.extractAgentId(session)
    if (!agentId) return

    let agent = await this.getOrReadAgent(agentId)
    if (!agent) {
      agent = this.createAgentData(agentId, session)
      this.agentCache.set(agentId, agent)
      this.writeBuffer.bufferAgent(agentId, agent)
    }

    this.safeLog({ message: 'Session tracking initialized', agentId })
  }

  async generateRetrospective(session: any): Promise<void> {
    if (!this.db.isAvailable) return

    const agentId = this.extractAgentId(session)
    if (!agentId) return

    this.safeLog({
      service: 'agent-tracker',
      level: 'info',
      message: 'Session retrospective generated',
      extra: { agentId, sessionId: session.id }
    })

    this.safeLog({ message: 'Retrospective generated', sessionId: session.id })
  }

  /**
   * Finalizes a session by flushing all buffered writes.
   * Flush runs regardless of agent ID -- there may be buffered data
   * from earlier operations in the same session.
   */
  async finalizeSession(session: any): Promise<void> {
    if (!this.db.isAvailable) return

    await this.flushWriteBuffer()

    const agentId = this.extractAgentId(session)
    if (agentId) {
      this.safeLog({ message: 'Session finalized', sessionId: session.id })
    }
  }

  /**
   * Flushes all buffered writes to the database (R6).
   */
  async flushWriteBuffer(): Promise<FlushResult> {
    const result = await this.writeBuffer.flush(this.db)
    this.agentCache.clear()
    return result
  }

  /**
   * Returns current agent status (R8.1).
   */
  async getAgentStatus(agentId: string): Promise<AgentStatus | null> {
    const agent = await this.getOrReadAgent(agentId)
    if (!agent) return null

    return {
      id: agent.id,
      skill_points: agent.skill_points,
      experience_points: agent.experience_points,
      communication_score: agent.communication_score,
      total_commits: agent.total_commits,
      total_bugs: agent.total_bugs,
      halted: agent.skill_points <= 0,
      active: agent.active
    }
  }

  /**
   * Reports a bug against an agent -- decrements SP (R8.1).
   */
  async reportBug(agentId: string): Promise<void> {
    const agent = await this.getOrReadAgent(agentId)
    if (!agent) return

    agent.skill_points -= 1
    agent.total_bugs += 1

    if (agent.skill_points <= 0) {
      agent.active = false
      await this.safeToast(
        `Agent ${agentId} halted: SP reached ${agent.skill_points}`,
        'error'
      )
    }

    this.bufferAgentUpdate(agent)
  }

  /**
   * Records both agent and user grades for a commit (R8.2).
   * Prompts the user for task description and notes via client.tui input.
   */
  async recordCommitGrade(agentId: string, commitHash: string, projectPath: string, agentGrade: Grade, userGrade: Grade): Promise<void> {
    const agent = await this.getOrReadAgent(agentId)
    if (!agent) return

    const scoreBefore = agent.communication_score
    agent.communication_score = Math.max(0, agent.communication_score + agentGrade + userGrade)
    agent.experience_points += 1

    const neededForNextLevel = 10000 * agent.skill_points
    if (agent.experience_points >= neededForNextLevel) {
      agent.skill_points += 1
      agent.experience_points = 0
    }

    this.bufferAgentUpdate(agent)

    const retrospective = await this.promptRetrospective(commitHash, agentGrade, userGrade, scoreBefore, agent.communication_score)

    this.writeBuffer.bufferRetrospective(agentId, commitHash, retrospective)
  }

  /**
   * Prompts the user for retrospective fields via client.tui.
   * Falls back to empty strings if the client API is unavailable.
   */
  private async promptRetrospective(
    commitHash: string,
    agentGrade: Grade,
    userGrade: Grade,
    scoreBefore: number,
    scoreAfter: number
  ): Promise<RetrospectiveEntry> {
    let task = ''
    let agentNote = ''
    let userNote = ''

    try {
      if (this.client?.tui?.input?.text) {
        task = (await this.client.tui.input.text({ message: 'Task description for this commit:' })) ?? ''
        agentNote = (await this.client.tui.input.text({ message: 'Agent note (what went well / could improve):' })) ?? ''
        userNote = (await this.client.tui.input.text({ message: 'User note (optional, press Enter to skip):' })) ?? ''
      }
    } catch (_error) {
      // Fall back to empty strings if prompting fails
    }

    return {
      commit: commitHash,
      timestamp: new Date().toISOString(),
      task,
      agent_grade: agentGrade,
      user_grade: userGrade,
      score_before: scoreBefore,
      score_after: scoreAfter,
      agent_note: agentNote,
      user_note: userNote
    }
  }

  /**
   * Records a retrospective entry (R8.2).
   */
  async recordRetrospective(agentId: string, entry: RetrospectiveEntry): Promise<void> {
    this.writeBuffer.bufferRetrospective(agentId, entry.commit, entry)
  }

  /**
   * Logs an activity journal entry (R8.3).
   */
  async logActivity(agentId: string, entry: ActivityEntry): Promise<void> {
    this.writeBuffer.bufferActivity(agentId, entry)
  }

  private createAgentData(agentId: string, session: any): AgentData {
    return {
      id: agentId,
      name: agentId,
      model: session?.model || 'unknown',
      scope: session?.scope || 'unknown',
      skill_points: 1,
      experience_points: 0,
      communication_score: 60,
      total_commits: 0,
      total_bugs: 0,
      active: true,
      created_at: new Date(),
      updated_at: new Date()
    }
  }
}
