import type { ChartDataPoint, Robot } from '../types/robot'

export const HISTORY_HOURS = 6
export const HISTORY_WINDOW_MS = HISTORY_HOURS * 60 * 60 * 1000

export interface DetailChartPoint extends ChartDataPoint {
  time: number
  chargingValue: number
}

export function decodeRouteParam(value: string | string[] | undefined): string {
  const routeValue = Array.isArray(value) ? value[0] : value

  if (!routeValue) {
    return ''
  }

  try {
    return decodeURIComponent(routeValue)
  } catch {
    return routeValue
  }
}

export function toChartPoint(robot: Robot): DetailChartPoint | null {
  const time = new Date(robot.timestamp).getTime()

  if (!Number.isFinite(time)) {
    return null
  }

  return {
    timestamp: robot.timestamp,
    batteryPercentage: robot.batteryPercentage,
    wifiSignalStrength: robot.wifiSignalStrength,
    isCharging: robot.isCharging,
    temperature: robot.temperature,
    memoryUsage: robot.memoryUsage,
    time,
    chargingValue: robot.isCharging ? 1 : 0,
  }
}

export function mergeChartPoints(
  currentPoints: DetailChartPoint[],
  incomingPoints: DetailChartPoint[],
  referenceTime = Date.now()
): DetailChartPoint[] {
  const cutoffTime = referenceTime - HISTORY_WINDOW_MS
  const pointsByTimestamp = new Map<string, DetailChartPoint>()

  currentPoints.concat(incomingPoints).forEach((point) => {
    if (point.time >= cutoffTime) {
      pointsByTimestamp.set(point.timestamp, point)
    }
  })

  return Array.from(pointsByTimestamp.values())
    .sort((left, right) => left.time - right.time)
}
