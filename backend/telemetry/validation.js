const FUTURE_TELEMETRY_TOLERANCE_MS = 5_000;

function getNowMs(now = Date.now) {
  const value = typeof now === 'function' ? now() : now;

  if (value instanceof Date) {
    return value.getTime();
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : Date.now();
}

function parseRobotMessage(message) {
  const rawMessage = Buffer.from(message).toString('utf8');

  if (!rawMessage.trim()) {
    return { error: 'Message body is empty' };
  }

  try {
    const parsed = JSON.parse(rawMessage);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'Message must be a JSON object' };
    }

    return { data: parsed };
  } catch (error) {
    return { error: 'Message must be valid JSON' };
  }
}

function validateNumber(data, field, errors, options = {}) {
  const value = data[field];

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${field} must be a finite number`);
    return undefined;
  }

  if (options.min !== undefined && value < options.min) {
    errors.push(`${field} must be greater than or equal to ${options.min}`);
  }

  if (options.max !== undefined && value > options.max) {
    errors.push(`${field} must be less than or equal to ${options.max}`);
  }

  return value;
}

function validateTelemetry(data, fallbackRobotId = '', options = {}) {
  const errors = [];
  const nowMs = getNowMs(options.now);
  const hasPayloadRobotId = Object.prototype.hasOwnProperty.call(data, 'robotId');
  let robotId = '';

  if (hasPayloadRobotId) {
    if (typeof data.robotId !== 'string' || data.robotId.trim() === '') {
      errors.push('robotId must be a non-empty string');
    } else {
      robotId = data.robotId.trim();
    }
  } else if (typeof fallbackRobotId === 'string' && fallbackRobotId.trim() !== '') {
    robotId = fallbackRobotId.trim();
  } else {
    errors.push('robotId must be a non-empty string');
  }

  const batteryPercentage = validateNumber(data, 'batteryPercentage', errors, {
    min: 0,
    max: 100,
  });
  const wifiSignalStrength = validateNumber(data, 'wifiSignalStrength', errors, {
    min: -100,
    max: 0,
  });
  const temperature = validateNumber(data, 'temperature', errors);
  const memoryUsage = validateNumber(data, 'memoryUsage', errors, {
    min: 0,
    max: 100,
  });

  if (typeof data.isCharging !== 'boolean') {
    errors.push('isCharging must be a boolean');
  }

  const timestamp = new Date(data.timestamp);
  if (!data.timestamp || Number.isNaN(timestamp.getTime())) {
    errors.push('timestamp must be a valid date');
  } else if (timestamp.getTime() > nowMs + FUTURE_TELEMETRY_TOLERANCE_MS) {
    errors.push('timestamp must not be more than 5 seconds in the future');
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    telemetry: {
      robotId,
      batteryPercentage,
      wifiSignalStrength,
      isCharging: data.isCharging,
      temperature,
      memoryUsage,
      timestamp,
    },
  };
}

module.exports = {
  FUTURE_TELEMETRY_TOLERANCE_MS,
  parseRobotMessage,
  validateTelemetry,
};
