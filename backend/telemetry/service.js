function resolveNowDate(now = () => new Date()) {
  const value = typeof now === 'function' ? now() : now;

  if (value instanceof Date) {
    return value;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function createTelemetryService({ RobotTelemetry, RobotLatestState, now = () => new Date() }) {
  if (!RobotTelemetry || !RobotLatestState) {
    throw new Error('RobotTelemetry and RobotLatestState models are required');
  }

  async function persistTelemetry(telemetry) {
    const receivedAt = resolveNowDate(now);

    await RobotTelemetry.create(telemetry);

    return RobotLatestState.findOneAndUpdate(
      { robotId: telemetry.robotId },
      {
        $set: {
          ...telemetry,
          lastSeen: receivedAt,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    ).lean();
  }

  async function listLatestRobots() {
    return RobotLatestState.find({})
      .sort({ robotId: 1 })
      .lean();
  }

  async function getRobotHistory(robotId, hours) {
    const since = new Date(resolveNowDate(now).getTime() - hours * 60 * 60 * 1000);

    return RobotTelemetry.find({
      robotId,
      timestamp: { $gte: since },
    })
      .sort({ timestamp: 1 })
      .lean();
  }

  return {
    getRobotHistory,
    listLatestRobots,
    persistTelemetry,
  };
}

module.exports = {
  createTelemetryService,
};
