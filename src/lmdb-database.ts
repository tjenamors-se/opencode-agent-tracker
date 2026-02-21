import { open, RootDatabase } from 'lmdb'
import type { AgentData, CommitData, CommunicationScoreEvent } from './types.js'

export class LMDBDatabase {
  private db: RootDatabase | null = null
  private available: boolean = false

  constructor(private databasePath: string = '~/.config/opencode/agent-tracker.lmdb') {
    this.available = this.initialize()
  }

  private initialize(): boolean {
    try {
      this.db = open({
      path: this.databasePath,
      compression: true
      })
      return true
    } catch (error) {
      console.error('LMDB initialization failed:', error)
      return false
    }
  }

  get isAvailable(): boolean {
    return this.available && this.db !== null
  }

  async putAgent(agentId: string, data: AgentData): Promise<boolean> {
    if (!this.isAvailable) return false
    
    try {
      await this.db!.put(`agent:${agentId}`, data)
      return true
    } catch (error) {
      console.error('Failed to put agent data:', error)
      return false
    }
  }

  async getAgent(agentId: string): Promise<AgentData | null> {
    if (!this.isAvailable) return null
    
    try {
      return await this.db!.get(`agent:${agentId}`)
    } catch (error) {
      console.error('Failed to get agent data:', error)
      return null
    }
  }

  async putCommit(projectPath: string, commitHash: string, data: CommitData): Promise<boolean> {
    if (!this.isAvailable) return false
    
    try {
      await this.db!.put(`commit:${projectPath}:${commitHash}`, data)
      return true
    } catch (error) {
      console.error('Failed to put commit data:', error)
      return false
    }
  }

  async getCommit(projectPath: string, commitHash: string): Promise<CommitData | null> {
    if (!this.isAvailable) return null
    
    try {
      return await this.db!.get(`commit:${projectPath}:${commitHash}`)
    } catch (error) {
      console.error('Failed to get commit data:', error)
      return null
    }
  }

  async putCommunicationEvent(event: CommunicationScoreEvent): Promise<boolean> {
    if (!this.isAvailable) return false
    
    try {
      const eventId = `${event.agent_id}:${event.commit_hash}:${Date.now()}`
      await this.db!.put(`communication:${eventId}`, event)
      return true
    } catch (error) {
      console.error('Failed to put communication event:', error)
      return false
    }
  }

  async getCommunicationEvents(agentId: string, limit: number = 100): Promise<CommunicationScoreEvent[]> {
    if (!this.isAvailable) return []
    
    try {
      const events: CommunicationScoreEvent[] = []
      const iterator = this.db!.getRange({ start: 'communication:', end: 'communication:~' })
      
      for (const { value } of iterator) {
        if (value?.agent_id === agentId) {
          events.push(value)
          if (events.length >= limit) {
            break
          }
        }
      }
      
      return events
    } catch (error) {
      console.error('Failed to get communication events:', error)
      return []
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close()
      this.db = null
      this.available = false
    }
  }
}