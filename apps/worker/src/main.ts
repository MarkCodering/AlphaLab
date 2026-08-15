import { createServer } from 'node:http';
import { resolve } from 'node:path';

const stateDirectory = resolve(process.env.ALPHALAB_WORKFLOW_STATE ?? './data/workflows');
const port = Number.parseInt(process.env.ALPHALAB_WORKER_PORT ?? '4311', 10);
const host = process.env.ALPHALAB_WORKER_HOST ?? '127.0.0.1';
const readyPayload = {
    status: 'ready',
    service: 'alphalab-worker',
    contractVersion: '1.0',
    stateDirectory,
  } as const;

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/v1/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(readyPayload));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ code: 'NOT_FOUND' }));
});

server.listen(port, host, () => {
  process.stdout.write(`${JSON.stringify({ ...readyPayload, host, port })}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
