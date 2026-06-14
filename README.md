# Robot Fleet Management Dashboard

Real-time robot fleet monitoring dashboard built with Node.js, uWebSockets.js, MongoDB, Next.js, Ant Design, and Recharts.

The system receives robot telemetry over WebSocket, validates and stores every valid message in MongoDB, broadcasts live updates to dashboard clients, shows current fleet health, and provides six-hour historical charts per robot.

## Architecture

```text
Robot Simulator(s)
  -> ws://backend:8080/robots
  -> Backend uWebSockets.js server
      - validates telemetry
      - stores telemetry in MongoDB
      - updates latest robot state
      - broadcasts robot_update events
  -> MongoDB

Dashboard UI
  -> GET /api/robots
  -> GET /api/robots/:robotId/history?hours=6
  -> ws://backend:8080/dashboard
```

Main folders:

- `backend/`: uWebSockets.js API/WebSocket server, MongoDB models, simulator, cluster entrypoint.
- `frontend/`: Next.js App Router dashboard and robot detail pages.
- `compose.yml`: MongoDB, clustered backend, and frontend services.

## Code Organization

- Backend runtime wiring stays in `backend/app.js`; telemetry validation, serialization, and database operations live under `backend/telemetry/` so they can be tested without starting uWebSockets.
- Frontend pages own rendering, navigation, data fetching, and notifications; reusable robot status, alert, and history transforms live under `frontend/src/utils/`.
- Backend unit tests use Node's built-in test runner. Frontend verification uses ESLint and the Next production build.

## Requirements

- Node.js 20 recommended for local development.
- Docker Desktop for Docker Compose.
- MongoDB local service or Docker container.

The backend uses `uWebSockets.js`; Node 24 may fail because the installed package does not ship binaries for that version. Use Node 20 or 18 locally.

## Local Setup

Install dependencies:

```bash
cd backend
npm install

cd ../frontend
npm install
```

Create `backend/.env` from the example:

```bash
cp backend/.env.example backend/.env
```

Default local values:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/robot-fleet
PORT=8080
WORKERS=2
```

Start MongoDB with Docker:

```bash
docker run --name robot-fleet-mongo -p 27017:27017 -d mongo:7
```

If the container already exists:

```bash
docker start robot-fleet-mongo
```

## Run Locally

Backend:

```bash
cd backend
npm run start
```

Clustered backend:

```bash
cd backend
WORKERS=2 npm run cluster
```

`PORT` controls the backend listen port. `WORKERS` controls the number of clustered backend workers. Use a different local port if Docker Compose is using `8080`:

```bash
PORT=8081 WORKERS=2 npm run cluster
```

Frontend:

```bash
cd frontend
npm run dev
```

Open:

```text
http://localhost:3000
```

Simulator:

```bash
cd backend
npm run simulator
```

The simulator creates five robots and sends telemetry every second to `ws://localhost:8080/robots`.

## Docker Compose

Start the full stack:

```bash
docker compose up -d --build
```

Services:

- MongoDB: `localhost:27017`
- Backend: `http://localhost:8080`
- Frontend: `http://localhost:3000`

Useful commands:

```bash
docker compose ps
docker compose logs backend
docker compose down
```

Stop local services that already use ports `27017`, `8080`, or `3000` before starting Compose.

## API Documentation

### `GET /health`

Returns server and database health.

Example:

```json
{
  "status": "ok",
  "database": "connected",
  "uptime": 123.45,
  "timestamp": "2026-06-14T10:30:00.000Z"
}
```

### `GET /api/robots`

Returns latest known state for each robot, sorted by `robotId`.

Example:

```json
{
  "robots": [
    {
      "robotId": "00001",
      "batteryPercentage": 84.5,
      "wifiSignalStrength": -48,
      "isCharging": false,
      "temperature": 44.2,
      "memoryUsage": 61,
      "timestamp": "2026-06-14T10:30:00.000Z",
      "lastSeen": "2026-06-14T10:30:00.000Z"
    }
  ]
}
```

### `GET /api/robots/:robotId/history?hours=6`

Returns historical telemetry for one robot within the requested recent window, sorted oldest to newest. `hours` defaults to `6`.

Example:

```json
{
  "robotId": "00001",
  "hours": 6,
  "data": [
    {
      "robotId": "00001",
      "batteryPercentage": 84.5,
      "wifiSignalStrength": -48,
      "isCharging": false,
      "temperature": 44.2,
      "memoryUsage": 61,
      "timestamp": "2026-06-14T10:30:00.000Z"
    }
  ]
}
```

## WebSocket Contract

### Robot telemetry socket

Connect robots to:

```text
ws://localhost:8080/robots?robotId=00001
```

Valid telemetry payload:

```json
{
  "robotId": "00001",
  "batteryPercentage": 85.5,
  "wifiSignalStrength": -45,
  "isCharging": false,
  "temperature": 42.3,
  "memoryUsage": 67,
  "timestamp": "2026-06-14T10:30:00.000Z"
}
```

Validation:

- `robotId`: non-empty string. Backend also falls back to query `robotId`.
- `batteryPercentage`: number from `0` to `100`.
- `wifiSignalStrength`: number from `-100` to `0`.
- `isCharging`: boolean.
- `temperature`: number.
- `memoryUsage`: number from `0` to `100`.
- `timestamp`: valid date, and must not be more than 5 seconds in the future.

Invalid telemetry is rejected without crashing the server. The robot socket receives:

```json
{
  "type": "telemetry_error",
  "message": "Invalid telemetry payload",
  "details": ["batteryPercentage must be less than or equal to 100"]
}
```

### Dashboard socket

Connect dashboard clients to:

```text
ws://localhost:8080/dashboard
```

Broadcast update:

```json
{
  "type": "robot_update",
  "robotId": "00001",
  "data": {
    "robotId": "00001",
    "batteryPercentage": 85.5,
    "wifiSignalStrength": -45,
    "isCharging": false,
    "temperature": 42.3,
    "memoryUsage": 67,
    "timestamp": "2026-06-14T10:30:00.000Z"
  }
}
```

## Database Schema

MongoDB database: `robot-fleet`.

### `robottelemetries`

Stores every valid telemetry message.

Fields:

- `robotId`
- `batteryPercentage`
- `wifiSignalStrength`
- `isCharging`
- `temperature`
- `memoryUsage`
- `timestamp`
- `createdAt`
- `updatedAt`

Indexes:

- `{ robotId: 1, timestamp: -1 }`
- `{ timestamp: -1 }`

### `robotlateststates`

Stores one latest state document per robot for dashboard initial load.

Fields are the telemetry fields plus:

- `lastSeen`
- `createdAt`
- `updatedAt`

Indexes:

- `{ robotId: 1 }` unique
- `{ timestamp: -1 }`

## Frontend Behavior

### Dashboard

The dashboard page:

- Fetches initial robots from `GET /api/robots`.
- Connects to `/dashboard` WebSocket.
- Updates table rows in real time.
- Shows battery, WiFi, charging status, temperature, memory, and last seen.
- Marks robots offline when no telemetry has arrived for 15 seconds.
- Navigates to `/robots/:robotId` when a row or view button is clicked.

### Alerts

Low battery:

- Trigger: `batteryPercentage < 20 && !isCharging`
- Message: `Robot {ID} is low battery!`
- Severity: warning
- Notifies once when condition becomes true.
- Resets when `batteryPercentage >= 20` or `isCharging === true`.

Critical battery:

- Trigger: low battery condition for at least 5 consecutive minutes.
- Message: `Robot {ID} will be shut down soon!`
- Severity: error
- Notifies once when threshold is reached.
- Resets when `batteryPercentage >= 20` or `isCharging === true`.

Alert state is tracked per robot in the browser.

### Robot Detail

The detail page at `/robots/[robotId]`:

- Fetches six hours of history from `GET /api/robots/:robotId/history?hours=6`.
- Shows charts for battery, WiFi, temperature, memory, and charging status.
- Appends matching live updates from `/dashboard`.
- Ignores live updates for other robots.
- Keeps chart points within the latest six-hour window.

## Clustering and Scaling

Run clustered backend locally:

```bash
cd backend
WORKERS=2 npm run cluster
```

`backend/cluster.js` forks `WORKERS` workers, or CPU count when `WORKERS` is not set. Workers listen on the same port through Node cluster.

Broadcast behavior:

- A worker receives telemetry.
- The worker validates and stores it in MongoDB.
- The worker sends the dashboard update to the primary process using cluster IPC.
- The primary process relays the update to every worker.
- Each worker publishes the update to its own connected dashboard clients.

Redis is not implemented. This means cross-worker broadcasts work inside one clustered backend process on one host, but separate backend containers or hosts would not share WebSocket broadcasts. For horizontal multi-host scaling, add Redis Pub/Sub or another shared message bus.

## Testing Checklist

Backend:

```bash
cd backend
npm run test
cd ..
node --check backend/app.js
node --check backend/database/index.js
node --check backend/cluster.js
node --check backend/simulator/robot-simulator.js
```

Frontend:

```bash
cd frontend
npm run lint
npm run build
```

Docker:

```bash
docker compose config
docker compose up -d --build
```

Manual checks:

- Invalid telemetry returns `telemetry_error` and does not crash the backend.
- Valid telemetry is stored in MongoDB.
- `GET /api/robots` returns latest robot states.
- `GET /api/robots/:robotId/history?hours=6` returns recent history for only that robot.
- Dashboard loads initial robots.
- Dashboard updates live from WebSocket messages.
- Offline status appears after simulator stops.
- Low battery warning fires once and resets.
- Critical battery error fires after five minutes and resets.
- Detail page charts load history.
- Detail page charts append only matching robot live updates.
- `npm run cluster` starts multiple workers.
- Docker Compose starts MongoDB, backend, and frontend.

## Known Trade-offs and Assumptions

- Node 20 is recommended because the current `uWebSockets.js` dependency may not support newer Node runtimes.
- The simulator reconnects automatically but has no configurable CLI arguments.
- The frontend stores alert notification state in memory; refreshing the browser resets notification state.
- Docker Compose does not include Redis because cluster IPC covers the required single-host worker fan-out.
- The frontend Docker image bakes `API_BASE_URL` and `WEBSOCKET_URL` at build time through build args.
