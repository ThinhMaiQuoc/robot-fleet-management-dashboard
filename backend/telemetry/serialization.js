const FUTURE_LAST_SEEN_TOLERANCE_MS = 5_000;

function getNowMs(now = Date.now) {
  const value = typeof now === 'function' ? now() : now;

  if (value instanceof Date) {
    return value.getTime();
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : Date.now();
}

function parseDateValue(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function serializeDate(value) {
  const date = parseDateValue(value);
  return date ? date.toISOString() : null;
}

function serializeRobotState(robot) {
  const timestamp = serializeDate(robot.timestamp);

  return {
    robotId: robot.robotId,
    batteryPercentage: robot.batteryPercentage,
    wifiSignalStrength: robot.wifiSignalStrength,
    isCharging: robot.isCharging,
    temperature: robot.temperature,
    memoryUsage: robot.memoryUsage,
    timestamp,
  };
}

function getLatestLastSeen(robot, options = {}) {
  const lastSeen = parseDateValue(robot.lastSeen);
  const updatedAt = parseDateValue(robot.updatedAt);
  const nowMs = getNowMs(options.now);

  if (lastSeen && lastSeen.getTime() <= nowMs + FUTURE_LAST_SEEN_TOLERANCE_MS) {
    return lastSeen;
  }

  return updatedAt || lastSeen || parseDateValue(robot.timestamp);
}

function serializeLatestRobotState(robot, options = {}) {
  const lastSeen = getLatestLastSeen(robot, options);

  return {
    ...serializeRobotState(robot),
    ...(lastSeen ? { lastSeen: serializeDate(lastSeen) } : {}),
  };
}

module.exports = {
  FUTURE_LAST_SEEN_TOLERANCE_MS,
  serializeRobotState,
  serializeLatestRobotState,
};
