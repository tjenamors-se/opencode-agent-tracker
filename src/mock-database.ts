import type { AgentData, CommitData, CommunicationScoreEvent } from './types.js'

export class MockDatabase {
  private agents: Map<string, AgentData> = new Map()
  private commits: Map<string, CommitData> = new Map()
  private communicationEvents: CommunicationScoreEvent[] = []
  public isAvailable: boolean = true

  constructor() {
    this.isAvailable = true
  }

  async putAgent(agentId: string, data: AgentData): Promise<boolean> {
    if (!this.isAvailable) return false
    this.agents.set(agentId, data)
    return true
  }

  async getAgent(agentId: string): Promise<AgentData | null> {
    if (!this.isAvailable) return null
    return this.agents.get(agentId) || null
  }

  async putCommit(projectPath: string, commitHash: string, data: CommitData): Promise<boolean> {
    if (!this.isAvailable) return false
    const key = `commit:${projectPath}:${commitHash}`
    this.commits.set(key, data)
    return true
  }

  async getCommit(projectPath: string, commitHash: string): Promise<CommitData | null> {
    if (!this.isAvailable) return null
    const key = `commit:${projectPath}:${commitHash}`
    return this.commits.get(key) || null
  }

  async putCommunicationEvent(event: CommunicationScoreEvent): Promise<boolean> {
    if (!this.isAvailable) return false
    this.communicationEvents.push(event)
    return true
  }

  async getCommunicationEvents(agentId: string, limit: number = 100): Promise<CommunicationScoreEvent[]> {
    if (!this.isAvailable) return []
    const events = this.communicationEvents.filter(e => e.agent_id === agentId)
    return events.slice(0, limit)
  }

  async close(): Promise<void> {
    this.isAvailable = false
  }

  // Test helper methods
  setAvailable(available: boolean): void {
    this.isAvailable = available
  }

  clear(): void {
    this.agents.clear()
    this.commits.clear()
    this.communicationEvents = []
  }
}