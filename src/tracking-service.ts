import type { AgentData, CommitData, CommunicationScoreEvent } from './types.js'
import type { Database } from './database.js'

interface ToolUsageEvent {
  agentId: string
  tool: string
  success: boolean
  timestamp: Date
}

// interface SessionData {
//   id: string
//   agentIds: string[]
//   startTime: Date
//   endTime?: Date
// }

export class TrackingService {
  constructor(
    private db: LMDBDatabase,
    private client: any
  ) {}

  async trackToolUsage(input: any, output: any): Promise<void> {
    if (!this.db.isAvailable) return
    
    const agentId = this.getAgentId(input)
    if (!agentId) return

    const event: ToolUsageEvent = {
      agentId,
      tool: input.tool,
      success: output.success,
      timestamp: new Date()
    }

    // Increment XP for successful tool usage
    if (output.success) {
      await this.incrementXP(agentId, 1)
    }

    await this.client.app.log({ body: { message: 'Tool usage tracked', agentId: event.agentId } })
  }

  async trackCommandCompletion(event: any): Promise<void> {
    if (!this.db.isAvailable) return
    
    const agentId = this.getAgentIdFromCommand(event)
    if (!agentId) return

    // Increment XP for successful command execution
    if (event.success) {
      await this.incrementXP(agentId, 2)
    }
  }

  async commitCompleted(agentId: string, commitHash: string, projectPath: string, taskDescription: string): Promise<void> {
    if (!this.db.isAvailable) return

    const commitData: CommitData = {
      agent_id: agentId,
      commit_hash: commitHash,
      project_path: projectPath,
      task_description: taskDescription,
      experience_gained: 5, // Base XP for commit completion
      communication_score_change: 0, // Will be updated by retrospective
      timestamp: new Date()
    }

    await this.db.putCommit(projectPath, commitHash, commitData)
    await this.incrementXP(agentId, commitData.experience_gained)
    await this.incrementCommitCount(agentId)

    await this.client.app.log({ body: { message: 'Commit tracked', commitHash: commitData.commit_hash } })
  }

  async recordCommunicationScore(agentId: string, commitHash: string, projectPath: string, grade: -1 | 1 | 2): Promise<void> {
    if (!this.db.isAvailable) return

    const event: CommunicationScoreEvent = {
      agent_id: agentId,
      commit_hash: commitHash,
      project_path: projectPath,
      grade,
      timestamp: new Date()
    }

    await this.db.putCommunicationEvent(event)

    // Aggregate the communication score
    const events = await this.db.getCommunicationEvents(agentId, 100)
    const totalScore = events.reduce((sum, e) => sum + e.grade, 0)
    
    await this.updateCommunicationScore(agentId, totalScore)

    await this.client.app.log({ body: { message: 'Communication score recorded', agentId: event.agent_id, grade: event.grade } })
  }

  async initializeSessionTracking(session: any): Promise<void> {
    if (!this.db.isAvailable) return

    const agentId = this.getAgentIdFromSession(session)
    if (!agentId) return

    let agent = await this.db.getAgent(agentId)
    if (!agent) {
      agent = await this.createAgent(agentId, session)
    }

    await this.client.app.log({ body: { message: 'Session tracking initialized', agentId } })
  }

  async generateRetrospective(session: any): Promise<void> {
    if (!this.db.isAvailable) return

    const agentId = this.getAgentIdFromSession(session)
    if (!agentId) return

    // Generate mini-retrospective
    await this.client.app.log({
      body: {
        service: 'agent-tracker',
        level: 'info',
        message: 'Session retrospective generated',
        extra: { agentId, sessionId: session.id }
      }
    })

    await this.client.app.log({ body: { message: 'Retrospective generated', sessionId: session.id } })
  }

  async finalizeSession(session: any): Promise<void> {
    if (!this.db.isAvailable) return

    const agentId = this.getAgentIdFromSession(session)
    if (!agentId) return

    await this.client.app.log({ body: { message: 'Session finalized', sessionId: session.id } })
  }

  private async incrementXP(agentId: string, xp: number): Promise<void> {
    const agent = await this.db.getAgent(agentId)
    if (!agent) return

    agent.experience_points += xp
    agent.updated_at = new Date()

    // Check for level up
    const neededForNextLevel = 10000 * agent.skill_points
    if (agent.experience_points >= neededForNextLevel) {
      agent.skill_points += 1
      agent.experience_points = 0
      
      await this.client.tui.toast.show({
        message: `Agent ${agentId} leveled up to SP ${agent.skill_points}!`,
        variant: 'success'
      })
    }

    await this.db.putAgent(agentId, agent)
  }

  private async incrementCommitCount(agentId: string): Promise<void> {
    const agent = await this.db.getAgent(agentId)
    if (!agent) return

    agent.total_commits += 1
    agent.updated_at = new Date()
    await this.db.putAgent(agentId, agent)
  }

  private async updateCommunicationScore(agentId: string, score: number): Promise<void> {
    const agent = await this.db.getAgent(agentId)
    if (!agent) return

    agent.communication_score = Math.max(0, score)
    agent.updated_at = new Date()
    await this.db.putAgent(agentId, agent)
  }

  private async createAgent(agentId: string, session: any): Promise<AgentData> {
    const agent: AgentData = {
      id: agentId,
      name: agentId,
      model: session?.model || 'unknown',
      scope: session?.scope || 'unknown',
      skill_points: 1,
      experience_points: 0,
      communication_score: 0,
      total_commits: 0,
      total_bugs: 0,
      active: true,
      created_at: new Date(),
      updated_at: new Date()
    }

    await this.db.putAgent(agentId, agent)
    return agent
  }

  private getAgentId(input: any): string | null {
    return input?.agentId || input?.agent?.id || null
  }

  private getAgentIdFromCommand(event: any): string | null {
    return event?.agentId || event?.agent?.id || null
  }

  private getAgentIdFromSession(session: any): string | null {
    return session?.agentId || session?.agent?.id || null
  }
}