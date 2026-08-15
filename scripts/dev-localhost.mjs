import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const host = '127.0.0.1';

async function isPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', (error) => {
      if (error && typeof error === 'object' && error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      reject(error);
    });
    probe.listen({ host, port }, () => probe.close(() => resolve(true)));
  });
}

async function choosePort(environmentName, preferred, reserved) {
  const configured = process.env[environmentName];
  if (configured) {
    const port = Number.parseInt(configured, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`${environmentName} must be an integer TCP port`);
    }
    if (reserved.has(port) || !(await isPortFree(port))) {
      throw new Error(`${environmentName}=${port} is already in use`);
    }
    reserved.add(port);
    return port;
  }
  for (let port = preferred; port < preferred + 100; port += 1) {
    if (!reserved.has(port) && (await isPortFree(port))) {
      reserved.add(port);
      return port;
    }
  }
  throw new Error(`No free localhost port found near ${preferred}`);
}

const reserved = new Set();
const ports = {
  web: await choosePort('ALPHALAB_WEB_PORT', 3000, reserved),
  api: await choosePort('ALPHALAB_API_PORT', 4310, reserved),
  worker: await choosePort('ALPHALAB_WORKER_PORT', 4311, reserved),
  model: await choosePort('ALPHALAB_MODEL_PORT', 8100, reserved),
  experiment: await choosePort('ALPHALAB_EXPERIMENT_PORT', 8101, reserved),
  verifier: await choosePort('ALPHALAB_VERIFIER_PORT', 8102, reserved),
};

const environment = {
  ...process.env,
  ALPHALAB_WEB_PORT: String(ports.web),
  ALPHALAB_API_PORT: String(ports.api),
  ALPHALAB_API_HOST: host,
  ALPHALAB_API_ORIGIN: `http://${host}:${ports.api}`,
  ALPHALAB_NEXT_DIST_DIR: `.next-local-${ports.web}`,
  ALPHALAB_WORKER_PORT: String(ports.worker),
  ALPHALAB_WORKER_HOST: host,
  ALPHALAB_WORKER_ORIGIN: `http://${host}:${ports.worker}`,
  ALPHALAB_MODEL_PORT: String(ports.model),
  ALPHALAB_MODEL_ORIGIN: `http://${host}:${ports.model}`,
  ALPHALAB_EXPERIMENT_PORT: String(ports.experiment),
  ALPHALAB_EXPERIMENT_ORIGIN: `http://${host}:${ports.experiment}`,
  ALPHALAB_VERIFIER_PORT: String(ports.verifier),
  ALPHALAB_VERIFIER_ORIGIN: `http://${host}:${ports.verifier}`,
};

process.stdout.write(
  [
    'AlphaLab localhost profile',
    `  workspace   http://${host}:${ports.web}`,
    `  api         http://${host}:${ports.api}/v1/health`,
    `  worker      http://${host}:${ports.worker}/v1/health`,
    `  model       http://${host}:${ports.model}/v1/health`,
    `  experiment  http://${host}:${ports.experiment}/v1/health`,
    `  verifier    http://${host}:${ports.verifier}/v1/health`,
    '',
  ].join('\n'),
);

const child = spawn(
  'pnpm',
  ['--parallel', '--stream', '--filter', './apps/**', '--filter', './services/**', 'dev'],
  { env: environment, stdio: 'inherit' },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.once('error', (error) => {
  process.stderr.write(`Failed to start the localhost profile: ${error.message}\n`);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  process.exitCode = signal ? 0 : (code ?? 1);
});
