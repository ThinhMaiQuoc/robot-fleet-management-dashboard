const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FUTURE_TELEMETRY_TOLERANCE_MS,
  parseRobotMessage,
  validateTelemetry,
} = require('../telemetry/validation.js');
const { serializeLatestRobotState } = require('../telemetry/serialization.js');
const { createTelemetryService } = require('../telemetry/service.js');

const NOW = new Date('2026-06-14T10:30:00.000Z');

function makeTelemetry(overrides = {}) {
  return {
    robotId: '00001',
    batteryPercentage: 75,
    wifiSignalStrength: -50,
    isCharging: false,
    temperature: 42,
    memoryUsage: 61,
    timestamp: NOW.toISOString(),
    ...overrides,
  };
}

test('parseRobotMessage parses a JSON object and rejects invalid messages', () => {
  assert.deepEqual(parseRobotMessage(Buffer.from('{"robotId":"00001"}')), {
    data: { robotId: '00001' },
  });
  assert.equal(parseRobotMessage(Buffer.from('')).error, 'Message body is empty');
  assert.equal(parseRobotMessage(Buffer.from('[]')).error, 'Message must be a JSON object');
  assert.equal(parseRobotMessage(Buffer.from('{bad json')).error, 'Message must be valid JSON');
});

test('validateTelemetry normalizes valid telemetry and ignores extra fields', () => {
  const result = validateTelemetry(makeTelemetry({
    robotId: '  ROBOT_001  ',
    extra: 'ignored',
  }), '', { now: NOW });

  assert.equal(result.errors, undefined);
  assert.equal(result.telemetry.robotId, 'ROBOT_001');
  assert.equal(result.telemetry.batteryPercentage, 75);
  assert.equal(result.telemetry.timestamp.toISOString(), NOW.toISOString());
  assert.equal(Object.hasOwn(result.telemetry, 'extra'), false);
});

test('validateTelemetry uses fallback robotId only when payload robotId is missing', () => {
  const missingRobotId = makeTelemetry();
  delete missingRobotId.robotId;

  assert.equal(
    validateTelemetry(missingRobotId, '  FALLBACK_001  ', { now: NOW }).telemetry.robotId,
    'FALLBACK_001'
  );

  const invalidPayloadRobotId = validateTelemetry(makeTelemetry({ robotId: ' ' }), 'FALLBACK_001', {
    now: NOW,
  });

  assert.ok(invalidPayloadRobotId.errors.includes('robotId must be a non-empty string'));
});

test('validateTelemetry reports invalid metric fields', () => {
  const result = validateTelemetry(makeTelemetry({
    batteryPercentage: 101,
    wifiSignalStrength: -101,
    isCharging: 'false',
    temperature: 'hot',
    memoryUsage: -1,
  }), '', { now: NOW });

  assert.ok(result.errors.includes('batteryPercentage must be less than or equal to 100'));
  assert.ok(result.errors.includes('wifiSignalStrength must be greater than or equal to -100'));
  assert.ok(result.errors.includes('isCharging must be a boolean'));
  assert.ok(result.errors.includes('temperature must be a finite number'));
  assert.ok(result.errors.includes('memoryUsage must be greater than or equal to 0'));
});

test('validateTelemetry rejects invalid timestamps', () => {
  const result = validateTelemetry(makeTelemetry({ timestamp: 'not-a-date' }), '', { now: NOW });

  assert.ok(result.errors.includes('timestamp must be a valid date'));
});

test('validateTelemetry rejects timestamps beyond future tolerance', () => {
  const timestamp = new Date(NOW.getTime() + FUTURE_TELEMETRY_TOLERANCE_MS + 1).toISOString();
  const result = validateTelemetry(makeTelemetry({ timestamp }), '', { now: NOW });

  assert.ok(result.errors.includes('timestamp must not be more than 5 seconds in the future'));
});

test('validateTelemetry accepts timestamps within future clock skew tolerance', () => {
  const timestamp = new Date(NOW.getTime() + FUTURE_TELEMETRY_TOLERANCE_MS).toISOString();
  const result = validateTelemetry(makeTelemetry({ timestamp }), '', { now: NOW });

  assert.equal(result.errors, undefined);
  assert.equal(result.telemetry.timestamp.toISOString(), timestamp);
});

test('serializeLatestRobotState falls back to updatedAt for future-dated lastSeen', () => {
  const updatedAt = new Date(NOW.getTime() - 10_000).toISOString();
  const lastSeen = new Date(NOW.getTime() + 60_000).toISOString();
  const serialized = serializeLatestRobotState({
    ...makeTelemetry(),
    lastSeen,
    updatedAt,
  }, { now: NOW });

  assert.equal(serialized.lastSeen, updatedAt);
});

test('createTelemetryService persists telemetry with server receipt time', async () => {
  const telemetry = validateTelemetry(makeTelemetry({ robotId: 'SERVICE_001' }), '', { now: NOW }).telemetry;
  let createdTelemetry;
  let latestUpdate;

  const RobotTelemetry = {
    create: async (value) => {
      createdTelemetry = value;
    },
  };
  const RobotLatestState = {
    findOneAndUpdate: (...args) => {
      latestUpdate = args;

      return {
        lean: async () => args[1].$set,
      };
    },
  };

  const service = createTelemetryService({
    RobotTelemetry,
    RobotLatestState,
    now: () => NOW,
  });
  const latestState = await service.persistTelemetry(telemetry);

  assert.equal(createdTelemetry, telemetry);
  assert.deepEqual(latestUpdate[0], { robotId: 'SERVICE_001' });
  assert.equal(latestUpdate[1].$set.lastSeen.toISOString(), NOW.toISOString());
  assert.equal(latestState.lastSeen.toISOString(), NOW.toISOString());
});
