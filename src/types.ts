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

export interface CommunicationScoreEvent {
  agent_id: string
  commit_hash: string
  project_path: string
  grade: -1 | 1 | 2
  timestamp: Date
  reason?: string
}

export interface TrackingServiceOptions {
  databasePath: string
  compression: boolean
  cacheSize: string
}

export type PluginConfig = {
  databasePath?: string
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