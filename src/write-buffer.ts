import type { Database } from './database.js'
import type { AgentData, CommitData, CommunicationScoreEvent, RetrospectiveEntry, ActivityEntry, FlushResult } from './types.js'

type BufferEntryType = 'agent' | 'commit' | 'communication' | 'retrospective' | 'activity'

interface BufferEntry {
  type: BufferEntryType
  data: unknown
  meta: Record<string, string>
}

export class WriteBuffer {
  private buffer: Map<string, BufferEntry> = new Map()

  bufferAgent(agentId: string, data: AgentData): void {
    this.buffer.set(`agent:${agentId}`, {
      type: 'agent',
      data,
      meta: { agentId }
    })
  }

  bufferCommit(projectPath: string, commitHash: string, data: CommitData): void {
    this.buffer.set(`commit:${projectPath}:${commitHash}`, {
      type: 'commit',
      data,
      meta: { projectPath, commitHash }
    })
  }

  bufferCommunicationEvent(event: CommunicationScoreEvent): void {
    const key = `communication:${event.agent_id}:${event.commit_hash}:${Date.now()}`
    this.buffer.set(key, {
      type: 'communication',
      data: event,
      meta: {}
    })
  }

  bufferRetrospective(agentId: string, commitHash: string, entry: RetrospectiveEntry): void {
    this.buffer.set(`retrospective:${agentId}:${commitHash}`, {
      type: 'retrospective',
      data: entry,
      meta: { agentId, commitHash }
    })
  }

  bufferActivity(agentId: string, entry: ActivityEntry): void {
    this.buffer.set(`activity:${agentId}:${entry.timestamp}`, {
      type: 'activity',
      data: entry,
      meta: { agentId }
    })
  }

  /**
   * Flushes all buffered entries to the database.
   * Each entry is routed to the correct database method.
   * Errors are collected, not thrown -- partial writes are possible.
   */
  async flush(db: Database): Promise<FlushResult> {
    const result: FlushResult = { entriesWritten: 0, errors: [] }

    if (this.buffer.size === 0) return result

    for (const [key, entry] of this.buffer) {
      try {
        const success = await this.writeEntry(db, entry)
        if (success) {
          result.entriesWritten++
        } else {
          result.errors.push(`Failed to write ${key}`)
        }
      } catch (error) {
        result.errors.push(`Error writing ${key}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    this.buffer.clear()
    return result
  }

  private async writeEntry(db: Database, entry: BufferEntry): Promise<boolean> {
    switch (entry.type) {
      case 'agent':
        return db.putAgent(entry.meta['agentId']!, entry.data as AgentData)
      case 'commit':
        return db.putCommit(entry.meta['projectPath']!, entry.meta['commitHash']!, entry.data as CommitData)
      case 'communication':
        return db.putCommunicationEvent(entry.data as CommunicationScoreEvent)
      case 'retrospective':
        return db.putRetrospective(entry.meta['agentId']!, entry.meta['commitHash']!, entry.data as RetrospectiveEntry)
      case 'activity':
        return db.putActivity(entry.meta['agentId']!, entry.data as ActivityEntry)
      default:
        return false
    }
  }

  clear(): void {
    this.buffer.clear()
  }

  get size(): number {
    return this.buffer.size
  }

  get isEmpty(): boolean {
    return this.buffer.size === 0
  }
}
