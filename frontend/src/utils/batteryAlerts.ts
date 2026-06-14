import type { Robot } from '../types/robot'
import { isLowBattery } from './robotStatus'

export const CRITICAL_BATTERY_MS = 5 * 60 * 1000

export interface BatteryAlertState {
  lowSince: number | null
  lowNotified: boolean
  criticalNotified: boolean
}

export interface BatteryAlertTransition {
  criticalBatteryStarted: boolean
  lowBatteryStarted: boolean
  state: BatteryAlertState
}

export function createInitialBatteryAlertState(): BatteryAlertState {
  return {
    lowSince: null,
    lowNotified: false,
    criticalNotified: false,
  }
}

export function getNextBatteryAlertState(
  robot: Robot,
  existingState: BatteryAlertState,
  now: number
): BatteryAlertTransition {
  if (!isLowBattery(robot)) {
    return {
      criticalBatteryStarted: false,
      lowBatteryStarted: false,
      state: createInitialBatteryAlertState(),
    }
  }

  const lowSince = existingState.lowSince || now
  const isCritical = now - lowSince >= CRITICAL_BATTERY_MS

  return {
    criticalBatteryStarted: !existingState.criticalNotified && isCritical,
    lowBatteryStarted: !existingState.lowNotified,
    state: {
      lowSince,
      lowNotified: true,
      criticalNotified: existingState.criticalNotified || isCritical,
    },
  }
}
