// language: TypeScript, file: src/server/app.ts, runtime: Node 22
// Fastify app: cấp challenge, phục vụ ảnh, chấm bài, phát event qua WS.
// Bind loopback. Ground truth không rời server (serialize thủ công, xem routes).

import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { isDifficulty, type Difficulty } from '../domain/challenge.js';
import { mulberry32 } from '../generator/prng.js';
import { loadManifest } from '../generator/assets.js';
import { buildPool, generate, type ImagePool } from '../generator/generate.js';
import { compose } from '../generator/compose.js';
import { distort } from '../generator/distort.js';
import { CHALLENGE_TTL_MS, Store, type RunConfig } from './store.js';
import { renderChallengePage } from './render.js';
import type { ChallengeResponse, VerifyResponse } from './types.js';

export const HOST = '127.0.0.1';

export interface ServerOptions {
  rootDir: string;
  store: Store;
  /** Thư mục ghi ảnh challenge. Mặc định <rootDir>/runs/<runId>/challenges. */
  imageRoot?: string;
  host?: string;
}

export interface SimEventLike {
  type: string;
  [key: string]: unknown;
}

/** Event do worker phát ra — khớp `SimEventLike` nên đi thẳng vào bus được. */
export interface WorkerEvent extends SimEventLike {
  type: 'worker';
  workerId: number;
  challengeId: string;
  state: string;
  ts: number;
  detail?: string;
}

// ~11 event mỗi lượt → đủ replay trọn một bench vài trăm đề cho người mở dashboard muộn.
const RING_LIMIT = 3000;

/** Event bus: ring buffer RING_LIMIT + broadcast. Fire-and-forget, không chặn worker. */
export class EventBus {
  private readonly ring: SimEventLike[] = [];
  private readonly clients = new Set<{ send: (data: string) => void; readyState: number; OPEN: number }>();
  emitted = 0;

  push(ev: SimEventLike): void {
    this.emitted += 1;
    this.ring.push(ev);
    if (this.ring.length > RING_LIMIT) this.ring.shift();
    const payload = JSON.stringify(ev);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  add(client: { send: (data: string) => void; readyState: number; OPEN: number }): void {
    this.clients.add(client);
    // Replay trước, rồi mới live — client vào giữa chừng vẫn có ngữ cảnh.
    for (const ev of this.ring) client.send(JSON.stringify(ev));
  }

  remove(client: { send: (data: string) => void; readyState: number; OPEN: number }): void {
    this.clients.delete(client);
  }

  get replayed(): number {
    return this.ring.length;
  }
}

const isLoopback = (addr: string | undefined): boolean => {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
};

export async function buildServer(opts: ServerOptions): Promise<{
  app: FastifyInstance;
  bus: EventBus;
  pool: ImagePool;
}> {
  const { rootDir, store } = opts;
  const manifest = loadManifest(rootDir);
  const pool = buildPool(manifest.images);
  const bus = new EventBus();
  const imageRoot = opts.imageRoot ?? path.join(rootDir, 'runs');

  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });

  await app.register(fastifyWebsocket);

  const publicDir = path.join(rootDir, 'public');
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir });
  }

  // Chỉ nhận request từ loopback (spec challenge-server: "Chỉ phục vụ loopback").
  app.addHook('onRequest', async (req, reply) => {
    if (!isLoopback(req.socket.remoteAddress ?? undefined)) {
      return reply.code(403).send({ error: 'chỉ phục vụ loopback' });
    }
    return undefined;
  });

  app.get('/ws', { websocket: true }, (socket) => {
    const client = socket as unknown as { send: (d: string) => void; readyState: number; OPEN: number };
    bus.add(client);
    socket.on('close', () => bus.remove(client));
  });

  /** Cấp challenge. Response KHÔNG chứa isTarget / target / splitObjects. */
  app.post<{ Body: { runId?: string; seed?: number; difficulty?: string } }>(
    '/api/challenges',
    async (req, reply) => {
      const runId = String(req.body?.runId ?? '').trim();
      if (!runId) return reply.code(400).send({ error: 'thiếu runId' });
      if (!store.getRun(runId)) return reply.code(404).send({ error: `run không tồn tại: ${runId}` });

      const difficultyRaw = req.body?.difficulty ?? 'medium';
      if (!isDifficulty(difficultyRaw)) {
        return reply.code(400).send({ error: `difficulty không hợp lệ: ${difficultyRaw}` });
      }
      const difficulty: Difficulty = difficultyRaw;

      const seed = Number.isInteger(req.body?.seed)
        ? (req.body?.seed as number)
        : Math.floor(Math.random() * 0x7fff_ffff);

      const rng = mulberry32(seed);
      const challenge = generate({ seed, pool, rng, options: { difficulty } });

      const runDir = path.join(imageRoot, runId, 'challenges');
      const imagePath = path.join(runDir, `${challenge.id}.png`);
      mkdirSync(runDir, { recursive: true });
      const composed = await compose(
        challenge,
        challenge.tiles.map((t) => ({
          index: t.index,
          absPath: path.join(rootDir, 'assets', 'images', t.category, t.source),
        })),
      );
      writeFileSync(imagePath, await distort(composed.buffer, difficulty));

      const createdAt = Date.now();
      const expiresAt = createdAt + CHALLENGE_TTL_MS;
      store.createChallenge({
        id: challenge.id,
        runId,
        seed,
        difficulty,
        target: challenge.target,
        grid: challenge.grid,
        tiles: challenge.tiles,
        splitObjects: challenge.splitObjects,
        createdAt,
        expiresAt,
      });

      const response: ChallengeResponse = {
        id: challenge.id,
        instruction: challenge.instruction,
        grid: challenge.grid,
        imageUrl: `/api/challenges/${challenge.id}/image`,
        expiresAt,
      };
      // Dashboard dựng thẻ ảnh từ đúng payload đã công khai cho worker — không kèm đáp án.
      bus.push({ type: 'challenge', ts: createdAt, ...response });
      return reply.code(201).send(response);
    },
  );

  app.get<{ Params: { id: string } }>('/api/challenges/:id/image', async (req, reply) => {
    const challenge = store.getChallenge(req.params.id);
    if (!challenge) return reply.code(404).send({ error: 'không có challenge' });
    const file = path.join(imageRoot, challenge.runId, 'challenges', `${challenge.id}.png`);
    if (!existsSync(file)) return reply.code(404).send({ error: 'ảnh chưa được sinh' });
    return reply.type('image/png').send(await sharp(file).png().toBuffer());
  });

  /** Trang cho worker mở. Chỉ có instruction + ảnh + vùng click. */
  app.get<{ Params: { id: string } }>('/c/:id', async (req, reply) => {
    const challenge = store.getChallenge(req.params.id);
    if (!challenge) return reply.code(404).type('text/html').send('<h1>404</h1>');
    return reply.type('text/html').send(
      renderChallengePage({
        id: challenge.id,
        instruction: `Select all images with ${challenge.target.replace(/_/g, ' ')}`,
        grid: challenge.grid,
        imageUrl: `/api/challenges/${challenge.id}/image`,
      }),
    );
  });

  /** Chấm bài server-side. Một lần thử cho mỗi challenge. */
  app.post<{
    Params: { id: string };
    Body: {
      selected?: unknown;
      solver?: string;
      workerId?: number;
      latencyMs?: number;
      solverMs?: number;
      totalMs?: number;
      coordSource?: string;
      usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
    };
  }>('/api/challenges/:id/verify', async (req, reply) => {
    const selectedRaw = req.body?.selected;
    if (!Array.isArray(selectedRaw)) {
      return reply.code(400).send({ error: 'selected phải là mảng' });
    }
    const selected = selectedRaw
      .map((v) => (typeof v === 'number' ? v : Number.parseInt(String(v), 10)))
      .filter((v) => Number.isInteger(v) && v >= 0);

    const coordSource =
      req.body?.coordSource === 'model' || req.body?.coordSource === 'derived'
        ? req.body.coordSource
        : null;

    const result = store.verify({
      challengeId: req.params.id,
      selected,
      solver: req.body?.solver ?? 'unknown',
      workerId: Number(req.body?.workerId ?? 0),
      latencyMs: Number(req.body?.latencyMs ?? 0),
      telemetry: {
        coordSource,
        solverMs: req.body?.solverMs ?? null,
        totalMs: req.body?.totalMs ?? null,
        usage: req.body?.usage ?? undefined,
      },
    });

    if (result.status === 'not_found') return reply.code(404).send({ error: 'không có challenge' });
    if (result.status === 'already_verified') {
      return reply.code(409).send({ error: 'challenge đã được chấm' });
    }
    if (result.status === 'expired') return reply.code(410).send({ error: 'challenge hết hạn' });

    const body: VerifyResponse = result.outcome;
    // Chỉ phát lại những gì verify đã trả cho người nộp: ô đã chọn + số đếm, không lộ ô đúng.
    bus.push({
      type: 'verdict',
      ts: Date.now(),
      challengeId: req.params.id,
      solver: req.body?.solver ?? 'unknown',
      selected,
      ...body,
    });
    return reply.send(body);
  });

  app.get<{ Params: { runId: string } }>('/api/runs/:runId', async (req, reply) => {
    const run = store.getRun(req.params.runId);
    if (!run) return reply.code(404).send({ error: 'không có run' });
    return reply.send({ ...store.summarizeRun(req.params.runId), config: run.config });
  });

  app.get('/api/health', async () => ({ ok: true, replay: bus.replayed }));

  return { app, bus, pool };
}

export function createRun(store: Store, input: { id: string; config: RunConfig }): void {
  store.createRun(input.id, input.config);
}
