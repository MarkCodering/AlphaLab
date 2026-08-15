import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { ReferenceWorkflowRunner } from './reference-runner.js';

const stateDirectory = resolve(process.env.ALPHALAB_WORKFLOW_STATE ?? './data/workflows');
const port = Number.parseInt(process.env.ALPHALAB_WORKER_PORT ?? '4311', 10);
const host = process.env.ALPHALAB_WORKER_HOST ?? '127.0.0.1';
const readyPayload = {
  status: 'ready',
  service: 'alphalab-worker',
  contractVersion: '1.0',
  stateDirectory,
} as const;
const referenceRunner = new ReferenceWorkflowRunner(stateDirectory);

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/v1/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(readyPayload));
    return;
  }
  const runMatch = request.url?.match(/^\/v1\/reference-runs\/([^/?]+)$/);
  if (request.method === 'GET' && runMatch) {
    const snapshot = await referenceRunner.load(decodeURIComponent(runMatch[1]!));
    if (!snapshot) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 'REFERENCE_RUN_NOT_FOUND' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(snapshot));
    return;
  }
  if (request.method === 'POST' && request.url === '/v1/reference-runs') {
    try {
      const payload = await readJsonBody(request);
      const snapshot = await referenceRunner.run(payload);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(snapshot));
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          code: 'REFERENCE_RUN_INVALID',
          message: error instanceof Error ? error.message : 'Invalid reference workflow request',
        }),
      );
    }
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

function readJsonBody(request: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body exceeds 1 MB'));
        request.destroy();
      }
    });
    request.on('error', reject);
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(body));
      } catch {
        reject(new Error('Request body must be valid JSON'));
      }
    });
  });
}
