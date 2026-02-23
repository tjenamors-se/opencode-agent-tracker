export interface AgentData {
  id: string
  name: string
  model: string
  scope: string
  skill_points: number
  experience_points: number
  communication_score: number
  total_commits: number
  total_bugs: number
  active: boolean
  created_at: Date
  updated_at: Date
}

export interface CommitData {
  agent_id: string
  commit_hash: string
  project_path: string
  task_description: string
  experience_gained: number
  communication_score_change: number
  timestamp: Date
}

/** Grade values for communication scoring (R7, R8.5) */
export type Grade = -1 | 1 | 2 | 5

/** Grade label mapping */
export const GRADE_LABELS: Record<Grade, string> = {
  [-1]: 'bad',
  [1]: 'neutral',
  [2]: 'good',
  [5]: 'excellence'
}

export interface CommunicationScoreEvent {
  agent_id: string
  commit_hash: string
  project_path: string
  grade: Grade
  timestamp: Date
  reason?: string
}

/** Database configuration for LMDBDatabase (R1, R2, R3) */
export interface DatabaseConfig {
  /** Database file path. Default: path.join(os.homedir(), '.config', 'opencode', 'agent-tracker.lmdb') */
  path?: string
  /** Maximum database size in bytes. Default: 512 MB. Range: 1 MB..2 GB */
  maxSize?: number
  /** Enable LMDB compression. Default: true */
  compression?: boolean
}

/** Retrospective entry for communication journal (R8.2) */
export interface RetrospectiveEntry {
  commit: string
  timestamp: string
  task: string
  agent_grade: Grade
  user_grade: Grade
  score_before: number
  score_after: number
  agent_note: string
  user_note: string
}

/** Activity journal entry (R8.3) */
export interface ActivityEntry {
  timestamp: string
  task: string
  actions: string
  outcome: string
  decisions: string
}

/** Agent status snapshot (R8.1) */
export interface AgentStatus {
  id: string
  skill_points: number
  experience_points: number
  communication_score: number
  total_commits: number
  total_bugs: number
  halted: boolean
  active: boolean
}

/** Result of a migration operation (R4) */
/** Record stored in LMDB after a successful migration (R4) */
export interface MigrationRecord {
  sourcePath: string
  version: string
  timestamp: Date
  entriesMigrated: number
}

export interface MigrationResult {
  entriesMigrated: number
  entriesSkipped: number
  errors: string[]
}

/** Result of flushing the write buffer (R6) */
export interface FlushResult {
  entriesWritten: number
  errors: string[]
}


/** Query input for searching prior art in the database (R11) */
export interface PriorArtQuery {
  taskDescription: string
  scope: string
  agentId?: string
  maxResults?: number
}

/** A single matched pattern from historical data (R11) */
export interface PatternMatch {
  source: 'retrospective' | 'activity' | 'commit'
  task: string
  notes: string
  grade?: Grade
  agentId: string
  scope: string
  timestamp: string
  relevanceScore: number
}

/** Categorized results from a prior art search (R11) */
export interface PriorArtResult {
  positivePatterns: PatternMatch[]
  crossScopePatterns: PatternMatch[]
  mistakes: PatternMatch[]
}

/** Retrospective entry with agent ID extracted from DB key (R11) */
export interface RetrospectiveWithAgent extends RetrospectiveEntry {
  agent_id: string
}

/** Activity entry with agent ID extracted from DB key (R11) */
export interface ActivityWithAgent extends ActivityEntry {
  agent_id: string
}

/** Project classification profile for cross-project learning (R12) */
export interface ProjectProfile {
  path: string
  language: string
  framework: string
  scope: string
  dependencies: string[]
  manifestType: string
  classifiedAt: string
  agentsmdHash: string
}

/** Git log match result for cross-project fallback search (R12) */
export interface GitLogMatch {
  projectPath: string
  commitHash: string
  message: string
  relevanceScore: number
}

export type PluginConfig = {
  databasePath?: string
  maxDatabaseSize?: number
  enableGitHooks?: boolean
  enableNotifications?: boolean
  enableEnvironmentProtection?: boolean
}

export type ToolExecuteInput = {
  tool: string
  args: Record<string, any>
}

export type ToolExecuteOutput = {
  args: Record<string, any>
}

export type OpenCodeContext = {
  project: any
  client: any
  $: any
  directory: string
  worktree: string
}

/** Result of an agent health check, run on every plugin event */
export interface AgentHealthStatus {
  agent_id: string
  skill_points: number
  experience_points: number
  communication_score: number
  total_commits: number
  total_bugs: number
  halted: boolean
  pending_changes: string[]
  checked_at: Date
}
