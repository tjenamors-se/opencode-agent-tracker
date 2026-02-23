import { open, RootDatabase, Database as LMDBStore } from 'lmdb'
import { homedir } from 'os'
import { join, isAbsolute } from 'path'
import { mkdirSync } from 'fs'
import type { Database } from './database.js'
import type { AgentData, CommitData, CommunicationScoreEvent, DatabaseConfig, RetrospectiveEntry, ActivityEntry } from './types.js'

const DEFAULT_PATH = join(homedir(), '.config', 'opencode', 'agent-tracker.lmdb')
const DEFAULT_MAP_SIZE = 512 * 1024 * 1024 // 512 MB
const MIN_MAP_SIZE = 1 * 1024 * 1024       // 1 MB
const MAX_MAP_SIZE = 2 * 1024 * 1024 * 1024 // 2 GB

export class LMDBDatabase implements Database {
  private root: RootDatabase | null = null
  private agentsDB: LMDBStore | null = null
  private commitsDB: LMDBStore | null = null
  private communicationDB: LMDBStore | null = null
  private retrospectivesDB: LMDBStore | null = null
  private activitiesDB: LMDBStore | null = null
  private available: boolean = false

  constructor(config: DatabaseConfig | string = {}) {
    const resolved = this.resolveConfig(config)
    this.available = this.initialize(resolved)
  }

  /**
   * Resolves config input to a normalized DatabaseConfig.
   * Accepts either a string path (backwards compat, tests) or a DatabaseConfig object.
   */
  private resolveConfig(config: DatabaseConfig | string): Required<DatabaseConfig> {
    if (typeof config === 'string') {
      return { path: config, maxSize: DEFAULT_MAP_SIZE, compression: true }
    }
    const path = this.resolvePath(config.path)
    const maxSize = config.maxSize ?? DEFAULT_MAP_SIZE
    const compression = config.compression ?? true
    return { path, maxSize, compression }
  }

  /**
   * Resolves database path using os.homedir().
   * Skips resolution for ':memory:' (test mode).
   */
  private resolvePath(customPath?: string): string {
    if (!customPath) return DEFAULT_PATH
    if (customPath === ':memory:') return ':memory:'
    if (isAbsolute(customPath)) return customPath
    return join(homedir(), customPath)
  }

  /**
   * Validates mapSize is within the allowed range.
   * @throws Error if mapSize is outside 1 MB..2 GB
   */
  private validateMapSize(mapSize: number): void {
    if (mapSize < MIN_MAP_SIZE || mapSize > MAX_MAP_SIZE) {
      throw new Error(
        `Database mapSize must be between ${MIN_MAP_SIZE} (1 MB) and ${MAX_MAP_SIZE} (2 GB), got ${mapSize}`
      )
    }
  }

  private initialize(config: Required<DatabaseConfig>): boolean {
    try {
      this.validateMapSize(config.maxSize)

      if (config.path !== ':memory:') {
        mkdirSync(config.path, { recursive: true })
      }

      this.root = open({
        path: config.path,
        compression: config.compression,
        mapSize: config.maxSize,
        maxDbs: 10
      })

      this.agentsDB = this.root.openDB('agents', {
        sharedStructuresKey: Symbol.for('structures:agents')
      })
      this.commitsDB = this.root.openDB('commits', {
        sharedStructuresKey: Symbol.for('structures:commits')
      })
      this.communicationDB = this.root.openDB('communication', {
        sharedStructuresKey: Symbol.for('structures:communication')
      })
      this.retrospectivesDB = this.root.openDB('retrospectives', {
        sharedStructuresKey: Symbol.for('structures:retrospectives')
      })
      this.activitiesDB = this.root.openDB('activities', {
        sharedStructuresKey: Symbol.for('structures:activities')
      })

      return true
    } catch (error) {
      console.error('LMDBDatabase initialization failed:', error)
      return false
    }
  }

  get isAvailable(): boolean {
    return this.available && this.root !== null
  }

  async putAgent(agentId: string, data: AgentData): Promise<boolean> {
    if (!this.isAvailable || !this.agentsDB) return false
    try {
      await this.agentsDB.put(agentId, data)
      return true
    } catch (_error) {
      return false
    }
  }

  async getAgent(agentId: string): Promise<AgentData | null> {
    if (!this.isAvailable || !this.agentsDB) return null
    try {
      const result = this.agentsDB.get(agentId) as AgentData | undefined
      return result ?? null
    } catch (_error) {
      return null
    }
  }

  async putCommit(projectPath: string, commitHash: string, data: CommitData): Promise<boolean> {
    if (!this.isAvailable || !this.commitsDB) return false
    try {
      await this.commitsDB.put(`${projectPath}:${commitHash}`, data)
      return true
    } catch (_error) {
      return false
    }
  }

  async getCommit(projectPath: string, commitHash: string): Promise<CommitData | null> {
    if (!this.isAvailable || !this.commitsDB) return null
    try {
      const result = this.commitsDB.get(`${projectPath}:${commitHash}`) as CommitData | undefined
      return result ?? null
    } catch (_error) {
      return null
    }
  }

  async putCommunicationEvent(event: CommunicationScoreEvent): Promise<boolean> {
    if (!this.isAvailable || !this.communicationDB) return false
    try {
      const key = `${event.agent_id}:${event.commit_hash}:${Date.now()}`
      await this.communicationDB.put(key, event)
      return true
    } catch (_error) {
      return false
    }
  }

  async getCommunicationEvents(agentId: string, limit: number = 100): Promise<CommunicationScoreEvent[]> {
    if (!this.isAvailable || !this.communicationDB) return []
    try {
      const events: CommunicationScoreEvent[] = []
      const range = this.communicationDB.getRange({ start: `${agentId}:`, end: `${agentId}:~` })
      for (const { value } of range) {
        events.push(value as CommunicationScoreEvent)
        if (events.length >= limit) break
      }
      return events
    } catch (_error) {
      return []
    }
  }

  async putRetrospective(agentId: string, commitHash: string, entry: RetrospectiveEntry): Promise<boolean> {
    if (!this.isAvailable || !this.retrospectivesDB) return false
    try {
      await this.retrospectivesDB.put(`${agentId}:${commitHash}`, entry)
      return true
    } catch (_error) {
      return false
    }
  }

  async getRetrospectives(agentId: string, limit: number = 100): Promise<RetrospectiveEntry[]> {
    if (!this.isAvailable || !this.retrospectivesDB) return []
    try {
      const entries: RetrospectiveEntry[] = []
      const range = this.retrospectivesDB.getRange({ start: `${agentId}:`, end: `${agentId}:~` })
      for (const { value } of range) {
        entries.push(value as RetrospectiveEntry)
        if (entries.length >= limit) break
      }
      return entries
    } catch (_error) {
      return []
    }
  }

  async putActivity(agentId: string, entry: ActivityEntry): Promise<boolean> {
    if (!this.isAvailable || !this.activitiesDB) return false
    try {
      await this.activitiesDB.put(`${agentId}:${entry.timestamp}`, entry)
      return true
    } catch (_error) {
      return false
    }
  }

  async getActivities(agentId: string, limit: number = 100): Promise<ActivityEntry[]> {
    if (!this.isAvailable || !this.activitiesDB) return []
    try {
      const entries: ActivityEntry[] = []
      const range = this.activitiesDB.getRange({ start: `${agentId}:`, end: `${agentId}:~` })
      for (const { value } of range) {
        entries.push(value as ActivityEntry)
        if (entries.length >= limit) break
      }
      return entries
    } catch (_error) {
      return []
    }
  }

  async close(): Promise<void> {
    try { if (this.agentsDB) await this.agentsDB.close() } catch (_e) { /* already closed */ }
    try { if (this.commitsDB) await this.commitsDB.close() } catch (_e) { /* already closed */ }
    try { if (this.communicationDB) await this.communicationDB.close() } catch (_e) { /* already closed */ }
    try { if (this.retrospectivesDB) await this.retrospectivesDB.close() } catch (_e) { /* already closed */ }
    try { if (this.activitiesDB) await this.activitiesDB.close() } catch (_e) { /* already closed */ }
    this.agentsDB = null
    this.commitsDB = null
    this.communicationDB = null
    this.retrospectivesDB = null
    this.activitiesDB = null
    try { if (this.root) await this.root.close() } catch (_e) { /* already closed */ }
    this.root = null
    this.available = false
  }
}
