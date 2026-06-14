import type { Robot } from '../types/robot'

export const OFFLINE_THRESHOLD_MS = 15_000

export type RobotStatus = 'online' | 'offline' | 'warning'

export function getLastSeenTime(robot: Robot): number {
  const lastSeen = robot.lastSeen || robot.timestamp
  const lastSeenTime = new Date(lastSeen).getTime()
  return Number.isFinite(lastSeenTime) ? lastSeenTime : 0
}

export function isLowBattery(robot: Robot): boolean {
  return robot.batteryPercentage < 20 && !robot.isCharging
}

export function getRobotStatus(robot: Robot, now: number): RobotStatus {
  const isOffline = now - getLastSeenTime(robot) > OFFLINE_THRESHOLD_MS

  if (isOffline) {
    return 'offline'
  }

  if (isLowBattery(robot)) {
    return 'warning'
  }

  return 'online'
}

export function formatRelativeTime(timestamp: number, now: number): string {
  if (!timestamp) {
    return 'Unknown'
  }

  const elapsedSeconds = Math.max(0, Math.round((now - timestamp) / 1000))

  if (elapsedSeconds < 5) {
    return 'Just now'
  }

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`
  }

  const elapsedMinutes = Math.round(elapsedSeconds / 60)
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`
  }

  const elapsedHours = Math.round(elapsedMinutes / 60)
  return `${elapsedHours}h ago`
}
