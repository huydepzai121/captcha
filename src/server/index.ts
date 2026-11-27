// language: TypeScript, file: src/server/index.ts, runtime: Node 22
// `pnpm serve` — dựng challenge server đứng một mình để mở dashboard xem live.

import path from 'node:path';
import { buildServer, HOST } from './app.js';
import { Store } from './store.js';

// Nạp .env nếu có (không ghi đè biến đã set trong shell); thiếu file thì bỏ qua.
try {
  process.loadEnvFile();
} catch {}

// Cổng đọc từ PORT (shell hoặc .env), mặc định 3000.
const PORT = Number(process.env.PORT) || 3000;

const main = async (): Promise<void> => {
  const rootDir = process.cwd();
  const store = new Store(path.join(rootDir, 'runs', 'serve.sqlite'));
  const { app } = await buildServer({ rootDir, store });
  await app.listen({ port: PORT, host: HOST });
  console.log(`[harness] pid=${process.pid} · http://${HOST}:${PORT}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
