// language: TypeScript, file: test/server.spec.ts
// Leak test, chấm điểm, một-lần-thử, hết hạn, bind loopback.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer, HOST, type EventBus } from '../src/server/app.js';
import { CHALLENGE_TTL_MS, Store } from '../src/server/store.js';

const ROOT = process.cwd();
const tmp = mkdtempSync(path.join(tmpdir(), 'harness-'));

let app: FastifyInstance;
let bus: EventBus;
let store: Store;
let baseUrl: string;
const runId = 'run-test';

const newChallenge = async (difficulty = 'medium'): Promise<{ id: string; raw: string }> => {
  const res = await fetch(`${baseUrl}/api/challenges`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId, difficulty }),
  });
  const raw = await res.text();
  expect(res.status).toBe(201);
  return { id: (JSON.parse(raw) as { id: string }).id, raw };
};

const truthOf = (id: string): number[] => {
  const challenge = store.getChallenge(id);
  if (!challenge) throw new Error(`không có challenge ${id}`);
  return challenge.tiles.filter((t) => t.isTarget).map((t) => t.index);
};

beforeAll(async () => {
  store = new Store(path.join(tmp, 'test.sqlite'));
  store.createRun(runId, {
    solver: 'test',
    workers: 1,
    trials: 1,
    difficulty: 'medium',
    seedStart: 0,
    commitSha: 'test',
  });
  const built = await buildServer({ rootDir: ROOT, store, imageRoot: tmp });
  app = built.app;
  bus = built.bus;
  await app.listen({ port: 0, host: HOST });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('không lấy được port');
  baseUrl = `http://${HOST}:${address.port}`;
});

afterAll(async () => {
  await app.close();
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('challenge server', () => {
  it('bind loopback', () => {
    const address = app.server.address();
    expect(typeof address).toBe('object');
    expect((address as { address: string }).address).toBe(HOST);
  });

  it('POST /api/challenges không rò ground truth', async () => {
    const { raw } = await newChallenge();
    expect(raw).not.toContain('isTarget');
    expect(raw).not.toContain('splitObjects');
    expect(raw).not.toMatch(/"target"/);
    expect(raw).not.toMatch(/\bbridge-\d{3}\.png\b/);
    expect(raw).toContain('imageUrl');
    expect(raw).toContain('instruction');
  });

  it('GET /c/:id không rò ground truth', async () => {
    const { id } = await newChallenge();
    const res = await fetch(`${baseUrl}/c/${id}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain('isTarget');
    expect(html).not.toContain('splitObjects');
    expect(html).not.toMatch(/\bbridge-\d{3}\.png\b/);
    expect(html).toContain('data-tile-index');
  });

  it('event dashboard (challenge + verdict) không rò ground truth', async () => {
    const seen: string[] = [];
    const client = { send: (d: string) => seen.push(d), readyState: 1, OPEN: 1 };
    const { id } = await newChallenge();
    bus.add(client);
    seen.length = 0; // bỏ phần replay, chỉ bắt event mới
    await fetch(`${baseUrl}/api/challenges/${id}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selected: [0], solver: 'test' }),
    });
    bus.remove(client);

    const verdict = seen.map((d) => JSON.parse(d) as Record<string, unknown>).find((e) => e.type === 'verdict');
    expect(verdict).toMatchObject({ challengeId: id, selected: [0], solver: 'test' });
    expect(typeof verdict?.ok).toBe('boolean');

    const replay: string[] = [];
    bus.add({ send: (d: string) => replay.push(d), readyState: 1, OPEN: 1 });
    const raw = replay.filter((d) => d.includes(id)).join(' ');
    expect(raw).toContain('"type":"challenge"');
    expect(raw).not.toContain('isTarget');
    expect(raw).not.toContain('splitObjects');
    expect(raw).not.toMatch(/"target"/);
  });

  it('ảnh grid phục vụ được dưới dạng PNG', async () => {
    const { id } = await newChallenge();
    const res = await fetch(`${baseUrl}/api/challenges/${id}/image`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('chọn đúng hết → ok true', async () => {
    const { id } = await newChallenge();
    const selected = truthOf(id);
    const res = await fetch(`${baseUrl}/api/challenges/${id}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selected }),
    });
    const body = (await res.json()) as { ok: boolean; wrong: number; missed: number };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.wrong).toBe(0);
    expect(body.missed).toBe(0);
  });

  it('chọn thừa một ô → ok false, wrong 1', async () => {
    const { id } = await newChallenge();
    const truth = new Set(truthOf(id));
    const extra = [...Array(16).keys()].find((i) => !truth.has(i));
    expect(extra).toBeDefined();
    const res = await fetch(`${baseUrl}/api/challenges/${id}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selected: [...truth, extra] }),
    });
    const body = (await res.json()) as { ok: boolean; wrong: number };
    expect(body.ok).toBe(false);
    expect(body.wrong).toBe(1);
  });

  it('thiếu một ô → ok false, missed 1', async () => {
    const { id } = await newChallenge();
    const truth = truthOf(id);
    const res = await fetch(`${baseUrl}/api/challenges/${id}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selected: truth.slice(1) }),
    });
    const body = (await res.json()) as { ok: boolean; missed: number };
    expect(body.ok).toBe(false);
    expect(body.missed).toBe(1);
  });

  it('verify lần hai → 409', async () => {
    const { id } = await newChallenge();
    const selected = truthOf(id);
    const post = () =>
      fetch(`${baseUrl}/api/challenges/${id}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selected }),
      });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(409);
  });

  it('hết hạn → 410 và ghi attempt với lý do expired', async () => {
    const id = 'expired-1';
    const now = Date.now();
    store.createChallenge({
      id,
      runId,
      seed: 1,
      difficulty: 'medium',
      target: 'bridge',
      grid: { cols: 4, rows: 4 },
      tiles: [
        { index: 0, source: 'bridge-000.png', category: 'bridge', isTarget: true },
        { index: 1, source: 'bus-000.png', category: 'bus', isTarget: false },
      ],
      splitObjects: [],
      createdAt: now - CHALLENGE_TTL_MS - 1000,
      expiresAt: now - 1000,
    });

    const res = await fetch(`${baseUrl}/api/challenges/${id}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selected: [0] }),
    });
    expect(res.status).toBe(410);
    const attempt = store.listAttempts(runId).find((a) => a.challengeId === id);
    expect(attempt?.failureReason).toBe('expired');
  });

  it('challenge không tồn tại → 404', async () => {
    const res = await fetch(`${baseUrl}/api/challenges/khong-co/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selected: [] }),
    });
    expect(res.status).toBe(404);
  });

  it('run không tồn tại khi cấp challenge → 404', async () => {
    const res = await fetch(`${baseUrl}/api/challenges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'khong-co' }),
    });
    expect(res.status).toBe(404);
  });

  it('WS replay ring buffer', async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    const body = (await health.json()) as { ok: boolean; replay: number };
    expect(body.ok).toBe(true);
    expect(typeof body.replay).toBe('number');
  });
});
