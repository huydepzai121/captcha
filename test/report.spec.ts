// language: TypeScript, file: test/report.spec.ts
// Report phải khớp dữ liệu thô trong store, và phân rã thất bại phải đủ mặt.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Store, type RunConfig } from '../src/server/store.js';
import { buildReport, renderReportMarkdown } from '../src/metrics/report.js';

const tmp = mkdtempSync(path.join(tmpdir(), 'report-'));
const runId = 'run-report';

const config: RunConfig = {
  solver: 'oracle',
  workers: 2,
  trials: 6,
  difficulty: 'medium',
  seedStart: 1,
  commitSha: 'test',
};

let store: Store;

const addChallenge = (id: string, index: number, target: 'bridge' | 'bus') => {
  const tiles = [
    { index: 0, source: 'a.png', category: target, isTarget: true },
    { index: 1, source: 'b.png', category: 'bus' as const, isTarget: false },
  ];
  store.createChallenge({
    id,
    runId,
    seed: index,
    difficulty: 'medium',
    target,
    grid: { cols: 2, rows: 2 },
    tiles,
    splitObjects: [],
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
};

beforeAll(() => {
  store = new Store(path.join(tmp, 'r.sqlite'));
  store.createRun(runId, config);

  // 2 đúng
  for (const index of [0, 1]) {
    const id = `ok-${index}`;
    addChallenge(id, index, index === 0 ? 'bridge' : 'bus');
    store.verify({ challengeId: id, selected: [0], solver: 'oracle', workerId: index, latencyMs: 10 + index });
  }

  // 1 sai
  addChallenge('bad-1', 2, 'bridge');
  store.verify({ challengeId: 'bad-1', selected: [1], solver: 'oracle', workerId: 0, latencyMs: 20 });

  // 1 timeout, 1 bad_schema
  addChallenge('fail-1', 3, 'bridge');
  store.recordFailure({
    challengeId: 'fail-1',
    runId,
    solver: 'oracle',
    workerId: 0,
    reason: 'timeout',
    latencyMs: 30_000,
  });
  addChallenge('fail-2', 4, 'bus');
  store.recordFailure({
    challengeId: 'fail-2',
    runId,
    solver: 'oracle',
    workerId: 1,
    reason: 'bad_schema',
    latencyMs: 5,
  });

  store.finishRun(runId);
});

afterAll(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('report', () => {
  it('solve rate khớp truy vấn thô', () => {
    const report = buildReport({ runId, store });
    const raw = store.listAttempts(runId);
    const rawOk = raw.filter((a) => a.ok).length;

    expect(report.totals.attempts).toBe(raw.length);
    expect(report.totals.ok).toBe(rawOk);
    expect(report.totals.solveRate).toBeCloseTo(rawOk / raw.length, 10);
  });

  it('phân rã thất bại đủ mặt và tổng khớp số attempt hỏng', () => {
    const report = buildReport({ runId, store });
    const failed = report.totals.attempts - report.totals.ok;
    const summed = Object.values(report.failures).reduce((a, b) => a + b, 0);
    expect(summed).toBe(failed);
    for (const reason of ['timeout', 'bad_schema', 'click_outside_grid', 'wrong_tiles', 'expired']) {
      expect(report.failures).toHaveProperty(reason);
    }
    expect(report.failures.timeout).toBe(1);
    expect(report.failures.bad_schema).toBe(1);
    expect(report.failures.wrong_tiles).toBe(1);
  });

  it('phân rã theo category khớp dữ liệu thô', () => {
    const report = buildReport({ runId, store });
    for (const [category, row] of Object.entries(report.byCategory)) {
      const expected = store
        .listAttempts(runId)
        .filter((a) => store.getChallenge(a.challengeId)?.target === category);
      expect(row.attempts).toBe(expected.length);
      expect(row.ok).toBe(expected.filter((a) => a.ok).length);
    }
  });

  it('không có judge thì phần judge ghi rõ là không chạy', () => {
    const report = buildReport({ runId, store });
    expect(report.judge.ran).toBe(false);
    const md = renderReportMarkdown(report);
    expect(md).toContain('Judge không chạy');
  });

  it('markdown chứa đủ mục chính', () => {
    const report = buildReport({ runId, store });
    const md = renderReportMarkdown(report);
    expect(md).toContain('## Tổng');
    expect(md).toContain('## Theo category');
    expect(md).toContain('## Theo độ khó');
    expect(md).toContain('## Độ trễ (ms)');
    expect(md).toContain('## Phân rã thất bại');
    expect(md).toContain('Kết luận chỉ áp dụng cho phân bố dữ liệu đã đo');
  });

  it('đường cong scaling xuất hiện khi được truyền vào', () => {
    const report = buildReport({
      runId,
      store,
      scaling: [{ workers: 8, trials: 6, wallMs: 6000, throughputPerMin: 60 }],
    });
    expect(report.scaling).toHaveLength(1);
    expect(renderReportMarkdown(report)).toContain('Đường cong scaling');
  });

  it('run không tồn tại thì ném lỗi rõ ràng', () => {
    expect(() => buildReport({ runId: 'khong-co', store })).toThrow(/không có run/);
  });
});
