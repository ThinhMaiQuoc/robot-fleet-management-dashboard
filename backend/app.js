const { App } = require('uWebSockets.js');
const mongoose = require('mongoose');
const qs = require('node:querystring');
const {
  connectDB,
  models: {
    RobotTelemetry,
    RobotLatestState,
  },
} = require('./database/index.js');
const {
  parseRobotMessage,
  validateTelemetry,
} = require('./telemetry/validation.js');
const {
  serializeLatestRobotState,
  serializeRobotState,
} = require('./telemetry/serialization.js');
const { createTelemetryService } = require('./telemetry/service.js');

const PORT = Number(process.env.PORT) || 8080;
const DASHBOARD_TOPIC = 'dashboard:robot-updates';
const telemetryService = createTelemetryService({
  RobotTelemetry,
  RobotLatestState,
});

const HTTP_STATUS = {
  200: '200 OK',
  204: '204 No Content',
  400: '400 Bad Request',
  404: '404 Not Found',
  500: '500 Internal Server Error',
};

function writeCorsHeaders(res) {
  return res
    .writeHeader('Access-Control-Allow-Origin', '*')
    .writeHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
    .writeHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, statusCode, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload);

  res.cork(() => {
    res.writeStatus(HTTP_STATUS[statusCode] || HTTP_STATUS[500]);
    writeCorsHeaders(res).writeHeader('Content-Type', 'application/json');
    res.end(body);
  });
}

function sendError(res, statusCode, message, details) {
  sendJson(res, statusCode, {
    error: message,
    ...(details ? { details } : {}),
  });
}

function sendWebSocketMessage(ws, payload) {
  try {
    ws.send(JSON.stringify(payload));
  } catch (error) {
    console.error('Failed to send WebSocket message:', error.message);
  }
}

function getSocketRobotId(ws) {
  const userData = typeof ws.getUserData === 'function' ? ws.getUserData() : ws;
  return typeof userData.robotId === 'string' ? userData.robotId : '';
}

function broadcastDashboardMessage(payload) {
  if (process.env.CLUSTER_WORKER === 'true' && typeof process.send === 'function') {
    try {
      process.send({
        type: 'dashboard:broadcast',
        payload,
      });
      return;
    } catch (error) {
      console.error('Failed to send dashboard update to primary process:', error.message);
    }
  }

  app.publish(DASHBOARD_TOPIC, payload);
}

function handleAsyncRoute(res, handler) {
  let aborted = false;

  res.onAborted(() => {
    aborted = true;
  });

  handler(() => aborted).catch((error) => {
    console.error('HTTP request failed:', error);

    if (!aborted) {
      sendError(res, 500, 'Internal server error');
    }
  });
}

const app = App({
  maxCompressedSize: 64 * 1024,
  maxBackpressure: 64 * 1024,
});

app.options('/*', (res) => {
  res.cork(() => {
    res.writeStatus(HTTP_STATUS[204]);
    writeCorsHeaders(res);
    res.end();
  });
});

app.get('/health', (res) => {
  sendJson(res, 200, {
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/robots', (res) => {
  handleAsyncRoute(res, async (isAborted) => {
    const robots = await telemetryService.listLatestRobots();

    if (!isAborted()) {
      sendJson(res, 200, {
        robots: robots.map(serializeLatestRobotState),
      });
    }
  });
});

app.get('/api/robots/:robotId/history', (res, req) => {
  const robotId = req.getParameter(0);
  const hoursQuery = req.getQuery('hours');
  const hours = hoursQuery === undefined ? 6 : Number(hoursQuery);

  handleAsyncRoute(res, async (isAborted) => {
    if (!robotId || !robotId.trim()) {
      if (!isAborted()) {
        sendError(res, 400, 'robotId is required');
      }
      return;
    }

    if (!Number.isFinite(hours) || hours <= 0) {
      if (!isAborted()) {
        sendError(res, 400, 'hours must be a positive number');
      }
      return;
    }

    const trimmedRobotId = robotId.trim();
    const history = await telemetryService.getRobotHistory(trimmedRobotId, hours);

    if (!isAborted()) {
      sendJson(res, 200, {
        robotId: trimmedRobotId,
        hours,
        data: history.map(serializeRobotState),
      });
    }
  });
});

app.ws('/robots', {
  maxPayloadLength: 16 * 1024,
  maxBackpressure: 64 * 1024,

  message: async (ws, message) => {
    const parsed = parseRobotMessage(message);

    if (parsed.error) {
      console.warn('Rejected robot telemetry:', parsed.error);
      sendWebSocketMessage(ws, {
        type: 'telemetry_error',
        message: parsed.error,
      });
      return;
    }

    const validation = validateTelemetry(parsed.data, getSocketRobotId(ws));

    if (validation.errors) {
      console.warn('Rejected robot telemetry:', validation.errors.join('; '));
      sendWebSocketMessage(ws, {
        type: 'telemetry_error',
        message: 'Invalid telemetry payload',
        details: validation.errors,
      });
      return;
    }

    try {
      const latestState = await telemetryService.persistTelemetry(validation.telemetry);

      const data = serializeLatestRobotState(latestState || {
        ...validation.telemetry,
        lastSeen: new Date(),
      });
      broadcastDashboardMessage(JSON.stringify({
        type: 'robot_update',
        robotId: data.robotId,
        data,
      }));
    } catch (error) {
      console.error('Failed to store robot telemetry:', error);
      sendWebSocketMessage(ws, {
        type: 'telemetry_error',
        message: 'Telemetry could not be stored',
      });
    }
  },

  open: (ws) => {
    console.log(`Robot ${getSocketRobotId(ws) || 'unknown'} connected`);
  },

  upgrade: (res, req, context) => {
    const secWebSocketKey = req.getHeader('sec-websocket-key');
    const secWebSocketProtocol = req.getHeader('sec-websocket-protocol');
    const secWebSocketExtensions = req.getHeader('sec-websocket-extensions');
    const query = qs.parse(req.getQuery()) || {};
    const queryRobotId = Array.isArray(query.robotId) ? query.robotId[0] : query.robotId;

    res.cork(() => {
      res.upgrade(
        {
          robotId: typeof queryRobotId === 'string' ? queryRobotId.trim() : '',
        },
        secWebSocketKey,
        secWebSocketProtocol,
        secWebSocketExtensions,
        context
      );
    });
  },

  close: (ws) => {
    console.log(`Robot ${getSocketRobotId(ws) || 'unknown'} disconnected`);
  },
});

app.ws('/dashboard', {
  maxPayloadLength: 16 * 1024,
  maxBackpressure: 64 * 1024,

  message: (ws, message) => {
    const parsed = parseRobotMessage(message);

    if (parsed.error) {
      console.warn('Rejected dashboard message:', parsed.error);
      return;
    }

    console.log('Dashboard message:', parsed.data);
  },

  open: (ws) => {
    ws.subscribe(DASHBOARD_TOPIC);
    console.log('Dashboard client connected');
  },

  close: () => {
    console.log('Dashboard client disconnected');
  },
});

app.any('/*', (res) => {
  sendError(res, 404, 'Not found');
});

process.on('message', (message) => {
  if (!message || message.type !== 'dashboard:broadcast' || typeof message.payload !== 'string') {
    return;
  }

  app.publish(DASHBOARD_TOPIC, message.payload);
});

connectDB()
  .then(() => {
    app.listen(PORT, (token) => {
      if (token) {
        console.log(`Robot Fleet Server listening on port ${PORT}`);
      } else {
        console.log('Failed to listen on port', PORT);
        process.exit(1);
      }
    });
  })
  .catch(() => {
    process.exit(1);
  });

async function shutdown() {
  console.log('\nShutting down server...');
  await mongoose.disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
