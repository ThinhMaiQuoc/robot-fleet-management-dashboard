require('dotenv').config();

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/robot-fleet';

const telemetryFields = {
  robotId: {
    type: String,
    required: true,
    trim: true,
  },
  batteryPercentage: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  wifiSignalStrength: {
    type: Number,
    required: true,
    min: -100,
    max: 0,
  },
  isCharging: {
    type: Boolean,
    required: true,
  },
  temperature: {
    type: Number,
    required: true,
  },
  memoryUsage: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  timestamp: {
    type: Date,
    required: true,
  },
};

const robotTelemetrySchema = new mongoose.Schema(telemetryFields, {
  timestamps: true,
  versionKey: false,
});

robotTelemetrySchema.index({ robotId: 1, timestamp: -1 });
robotTelemetrySchema.index({ timestamp: -1 });

const robotLatestStateSchema = new mongoose.Schema({
  ...telemetryFields,
  lastSeen: {
    type: Date,
    required: true,
  },
}, {
  timestamps: true,
  versionKey: false,
});

robotLatestStateSchema.index({ robotId: 1 }, { unique: true });
robotLatestStateSchema.index({ timestamp: -1 });

const RobotTelemetry = mongoose.models.RobotTelemetry
  || mongoose.model('RobotTelemetry', robotTelemetrySchema);
const RobotLatestState = mongoose.models.RobotLatestState
  || mongoose.model('RobotLatestState', robotLatestStateSchema);

const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI, {});
    await Promise.all([
      RobotTelemetry.init(),
      RobotLatestState.init(),
    ]);
    console.log(`Connected to MongoDB at ${MONGODB_URI}`);
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error.message);
    throw error;
  }
};

module.exports = {
  connectDB,
  models: {
    RobotTelemetry,
    RobotLatestState,
  },
};
