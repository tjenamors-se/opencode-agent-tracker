import type { Database } from './database.js'
import type { AgentData, CommitData, CommunicationScoreEvent, RetrospectiveEntry, ActivityEntry, MigrationRecord } from './types.js'

export class MockDatabase implements Database {
  private agents: Map<string, AgentData> = new Map()
  private commits: Map<string, CommitData> = new Map()
  private communicationEvents: CommunicationScoreEvent[] = []
  private retrospectives: Map<string, RetrospectiveEntry> = new Map()
  private activities: Map<string, ActivityEntry> = new Map()
  private migrations: Map<string, MigrationRecord> = new Map()
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
    return this.agents.get(agentId) ?? null
  }

  async putCommit(projectPath: string, commitHash: string, data: CommitData): Promise<boolean> {
    if (!this.isAvailable) return false
    this.commits.set(`${projectPath}:${commitHash}`, data)
    return true
  }

  async getCommit(projectPath: string, commitHash: string): Promise<CommitData | null> {
    if (!this.isAvailable) return null
    return this.commits.get(`${projectPath}:${commitHash}`) ?? null
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

  async putRetrospective(agentId: string, commitHash: string, entry: RetrospectiveEntry): Promise<boolean> {
    if (!this.isAvailable) return false
    this.retrospectives.set(`${agentId}:${commitHash}`, entry)
    return true
  }

  async getRetrospectives(agentId: string, limit: number = 100): Promise<RetrospectiveEntry[]> {
    if (!this.isAvailable) return []
    const entries: RetrospectiveEntry[] = []
    for (const [key, value] of this.retrospectives) {
      if (key.startsWith(`${agentId}:`)) {
        entries.push(value)
        if (entries.length >= limit) break
      }
    }
    return entries
  }

  async putActivity(agentId: string, entry: ActivityEntry): Promise<boolean> {
    if (!this.isAvailable) return false
    this.activities.set(`${agentId}:${entry.timestamp}`, entry)
    return true
  }

  async getActivities(agentId: string, limit: number = 100): Promise<ActivityEntry[]> {
    if (!this.isAvailable) return []
    const entries: ActivityEntry[] = []
    for (const [key, value] of this.activities) {
      if (key.startsWith(`${agentId}:`)) {
        entries.push(value)
        if (entries.length >= limit) break
      }
    }
    return entries
  }

  async putMigration(sourceDir: string, record: MigrationRecord): Promise<boolean> {
    if (!this.isAvailable) return false
    this.migrations.set(sourceDir, record)
    return true
  }

  async getMigration(sourceDir: string): Promise<MigrationRecord | null> {
    if (!this.isAvailable) return null
    return this.migrations.get(sourceDir) ?? null
  }

  async close(): Promise<void> {
    this.isAvailable = false
  }

  setAvailable(available: boolean): void {
    this.isAvailable = available
  }

  clear(): void {
    this.agents.clear()
    this.commits.clear()
    this.communicationEvents = []
    this.retrospectives.clear()
    this.activities.clear()
    this.migrations.clear()
  }
}
