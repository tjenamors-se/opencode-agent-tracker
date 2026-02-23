import type { AgentData, CommitData, CommunicationScoreEvent, RetrospectiveEntry, ActivityEntry } from './types.js'

export interface Database {
  isAvailable: boolean
  putAgent(agentId: string, data: AgentData): Promise<boolean>
  getAgent(agentId: string): Promise<AgentData | null>
  putCommit(projectPath: string, commitHash: string, data: CommitData): Promise<boolean>
  getCommit(projectPath: string, commitHash: string): Promise<CommitData | null>
  putCommunicationEvent(event: CommunicationScoreEvent): Promise<boolean>
  getCommunicationEvents(agentId: string, limit?: number): Promise<CommunicationScoreEvent[]>
  putRetrospective(agentId: string, commitHash: string, entry: RetrospectiveEntry): Promise<boolean>
  getRetrospectives(agentId: string, limit?: number): Promise<RetrospectiveEntry[]>
  putActivity(agentId: string, entry: ActivityEntry): Promise<boolean>
  getActivities(agentId: string, limit?: number): Promise<ActivityEntry[]>
  close(): Promise<void>
}
