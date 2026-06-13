const cluster = require('node:cluster');
const os = require('node:os');

function getWorkerCount() {
  const configuredWorkers = Number.parseInt(process.env.WORKERS || '', 10);

  if (Number.isInteger(configuredWorkers) && configuredWorkers > 0) {
    return configuredWorkers;
  }

  if (typeof os.availableParallelism === 'function') {
    return os.availableParallelism();
  }

  return os.cpus().length;
}

if (cluster.isPrimary) {
  const workerCount = getWorkerCount();
  let isShuttingDown = false;

  console.log(`Starting ${workerCount} backend workers on port ${process.env.PORT || 8080}`);

  function forkWorker(index) {
    const worker = cluster.fork({
      ...process.env,
      CLUSTER_WORKER: 'true',
      WORKER_ID: String(index),
    });

    console.log(`Worker ${worker.process.pid} started`);
    return worker;
  }

  for (let index = 1; index <= workerCount; index += 1) {
    forkWorker(index);
  }

  cluster.on('message', (sourceWorker, message) => {
    if (!message || message.type !== 'dashboard:broadcast' || typeof message.payload !== 'string') {
      return;
    }

    for (const worker of Object.values(cluster.workers)) {
      if (worker?.isConnected()) {
        worker.send({
          type: 'dashboard:broadcast',
          payload: message.payload,
          sourcePid: sourceWorker.process.pid,
        });
      }
    }
  });

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} exited with code ${code} signal ${signal}`);

    if (!isShuttingDown) {
      forkWorker(worker.id);
    }
  });

  function shutdown() {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.log('Shutting down clustered backend...');

    for (const worker of Object.values(cluster.workers)) {
      worker?.kill('SIGTERM');
    }

    setTimeout(() => {
      process.exit(0);
    }, 5000).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else {
  require('./app.js');
}
