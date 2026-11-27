// language: TypeScript, file: agent/env.ts, runtime: Node 22
// Nạp `.env` MỘT chỗ cho mọi entrypoint của agent (index, bench, smoke).
// Trước đây mỗi entrypoint tự parse lấy — thêm entrypoint là thêm một bản sao,
// và quên một chỗ là entrypoint đó chết với "key chưa set".
//
// Không ghi đè biến đã có trong shell: shell là ý người, .env là mặc định.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function loadDotEnv(file = path.join(process.cwd(), '.env')): void {
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    const name = match?.[1];
    if (!name || name in process.env) continue;
    process.env[name] = (match?.[2] ?? '').trim().replace(/^["']|["']$/g, '');
  }
}
