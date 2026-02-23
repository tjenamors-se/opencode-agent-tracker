import figlet from 'figlet'
import type { AgentHealthStatus } from './types.js'

const MAX_WIDTH = 80
const BAR_WIDTH = 30

/**
 * Maps SP value to trust tier label.
 */
export function getTrustTier(sp: number): string {
  if (sp >= 10) return 'EXPERT'
  if (sp >= 7) return 'SENIOR'
  if (sp >= 4) return 'ESTABLISHED'
  if (sp >= 2) return 'JUNIOR'
  return 'PROBATION'
}

/**
 * Renders agent name as FIGlet ASCII art using Cybermedium font.
 * Falls back to plain uppercase text if rendered width exceeds MAX_WIDTH.
 */
export function renderAgentName(name: string): string {
  try {
    const rendered = figlet.textSync(name, {
      font: 'Cybersmall',
      width: MAX_WIDTH,
      whitespaceBreak: true,
    })
    return rendered
  } catch {
    return name.toUpperCase()
  }
}

/**
 * Renders ASCII progress bar.
 * @param current - Current value
 * @param max - Maximum value (threshold)
 * @param width - Bar width in characters (inner width, excluding brackets)
 * @returns Formatted bar string, e.g. "[=========-----------] 66%"
 */
export function renderProgressBar(current: number, max: number, width: number): string {
  if (max <= 0) return `[${'='.repeat(width)}] MAX`
  const ratio = Math.min(current / max, 1)
  const filled = Math.round(ratio * width)
  const empty = width - filled
  const pct = Math.round(ratio * 100)
  return `[${'='.repeat(filled)}${'-'.repeat(empty)}] ${pct}%`
}

/**
 * Formats AgentHealthStatus into a Tron HUD player sheet.
 * Uses FIGlet Cybermedium for agent name, pure ASCII layout, no Unicode box-drawing.
 */
export function formatHealthStatus(health: AgentHealthStatus): string {
  const lines: string[] = []

  const nameArt = renderAgentName(health.agent_id)
  lines.push(nameArt)

  const tier = getTrustTier(health.skill_points)
  const sp = health.skill_points.toFixed(1)
  const xp = health.experience_points.toFixed(1)
  const cs = health.communication_score.toFixed(1)
  const commits = health.total_commits.toFixed(1)
  const bugs = health.total_bugs.toFixed(1)
  const spThreshold = (10 * health.skill_points).toFixed(1)

  const sep = '='.repeat(MAX_WIDTH)

  lines.push(`  ${sep}`)
  lines.push(`  CLASS : ${tier}`)
  lines.push(`  ${sep}`)
  lines.push(`  SP    : ${sp}        CS    : ${cs}`)
  lines.push(`  XP    : ${xp} / ${spThreshold}`)
  lines.push(`  ${renderProgressBar(health.experience_points, 10 * health.skill_points, BAR_WIDTH)}`)
  lines.push(`  ${sep}`)
  lines.push(`  COMMITS : ${commits}    BUGS : ${bugs}`)
  lines.push(`  HALTED  : ${health.halted ? 'YES' : 'no'}`)

  if (health.pending_changes.length > 0) {
    lines.push(`  ${sep}`)
    const maxShow = 5
    const shown = health.pending_changes.slice(0, maxShow)
    lines.push(`  PENDING (${health.pending_changes.length}):`)
    for (const change of shown) {
      lines.push(`    ${change}`)
    }
    if (health.pending_changes.length > maxShow) {
      lines.push(`    + ${health.pending_changes.length - maxShow} more`)
    }
  }

  lines.push(`  ${sep}`)

  return lines.join('\n')
}
