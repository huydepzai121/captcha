// Challenge server của sim: Fastify + WS, serve dashboard tĩnh,
// API điều khiển run (start/stop/replay), event bus broadcast tới mọi client.

import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runRecaptchaSession } from './recaptcha.js';
import { randomSolver, visionSolver, type ClickSolver } from './solver.js';
import type { SimEvent } from './types.js';

const PORT = 3000;
const HOST = '127.0.0.1';
const RING_LIMIT = 500;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

interface RunState {
  running: boolean;
  events: SimEvent[]; // ring buffer 500
  solved: number;
  failed: number;
  solver: string;
  controller: AbortController | null;
}

const state: RunState = {
  running: false,
  events: [],
  solved: 0,
  failed: 0,
  solver: 'random',
  controller: null,
};

const clients = new Set<WebSocket>();

const pushEvent = (ev: SimEvent): void => {
  state.events.push(ev);
  if (state.events.length > RING_LIMIT) state.events.shift();
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(ev));
  }
};

const makeSolver = (name: string): ClickSolver => {
  if (name.startsWith('vision')) {
    // vision hoặc vision:<model-id>
    const model = name.includes(':') ? name.slice('vision:'.length) : undefined;
    return visionSolver(model);
  }
  return randomSolver();
};

async function main(): Promise<void> {
  const app: FastifyInstance = Fastify({ logger: false });

  await app.register(fastifyStatic, { root: publicDir });
  await app.register(fastifyWebsocket);

  // replay + live: client connect, nhận toàn bộ ring buffer, rồi event mới
  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    for (const ev of state.events) socket.send(JSON.stringify(ev));
    socket.on('close', () => clients.delete(socket));
  });

  app.post<{ Body: { solver?: string; headless?: boolean } }>(
    '/api/run/start',
    async (req, reply) => {
      if (state.running) return reply.code(409).send({ error: 'run đang chạy' });
      const solverName = req.body?.solver ?? 'random';
      const headless = req.body?.headless ?? true;
      state.running = true;
      state.solver = solverName;
      state.events = [];
      state.controller = new AbortController();
      pushEvent({
        type: 'stats',
        running: true,
        solver: solverName,
        solved: state.solved,
        failed: state.failed,
      });
      const solver = makeSolver(solverName);
      // chạy nền; kết quả đẩy qua event bus
      void runRecaptchaSession({
        solver,
        emit: (ev) => {
          if (ev.type === 'result') {
            if (ev.solved) state.solved += 1;
            else state.failed += 1;
            state.running = false;
            pushEvent({
              type: 'stats',
              running: false,
              solver: state.solver,
              solved: state.solved,
              failed: state.failed,
            });
          }
          pushEvent(ev);
        },
        headless,
        signal: state.controller.signal,
      }).finally(() => {
        if (state.running) {
          // run kết thúc mà không có result-event (crash)
          state.running = false;
          pushEvent({
            type: 'stats',
            running: false,
            solver: state.solver,
            solved: state.solved,
            failed: state.failed,
          });
        }
        state.controller = null;
      });
      return { ok: true, solver: solverName, headless };
    },
  );

  app.post('/api/run/stop', async (_req, reply) => {
    if (!state.controller) return reply.code(409).send({ error: 'không có run nào' });
    state.controller.abort();
    return { ok: true };
  });

  app.get('/api/state', async () => ({
    running: state.running,
    solver: state.solver,
    solved: state.solved,
    failed: state.failed,
    events: state.events.length,
  }));

  await app.listen({ port: PORT, host: HOST });
  console.log(`[sim] dashboard -> http://${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});