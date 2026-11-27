// language: TypeScript, file: src/worker/guard.ts, runtime: Node 22
// Allowlist host cứng (spec worker-pool: "Allowlist host cứng").
// Viết thẳng trong mã nguồn — KHÔNG đọc từ env, file cấu hình, hay tham số CLI.
// Đây là lớp cưỡng chế thứ nhất; lớp thứ hai là scripts/lint-boundaries.ts.

import type { BrowserContext, Route } from 'playwright';

export const ALLOWED_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

export class BlockedHostError extends Error {
  readonly host: string;

  constructor(host: string, url: string) {
    super(`chặn truy cập host ngoài allowlist: ${host} (${url})`);
    this.name = 'BlockedHostError';
    this.host = host;
  }
}

export const isAllowedUrl = (raw: string): boolean => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'about:') return true;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.includes(host);
};

/**
 * Cắm guard vào browser context. Request ra ngoài bị abort tại tầng route và
 * ném lỗi — worker kết thúc ở FAILED, không âm thầm đi tiếp.
 */
export async function installGuard(context: BrowserContext): Promise<void> {
  await context.route('**', async (route: Route) => {
    const url = route.request().url();
    if (isAllowedUrl(url)) {
      await route.continue();
      return;
    }
    await route.abort();
    throw new BlockedHostError(new URL(url).hostname, url);
  });
}
