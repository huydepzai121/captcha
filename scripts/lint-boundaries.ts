// language: TypeScript, file: scripts/lint-boundaries.ts, runtime: Node 22
// Cưỡng chế ranh giới dự án ở CI (spec worker-pool: "Cưỡng chế ranh giới ở CI").
// Quét mã nguồn + package.json, thoát khác 0 khi thấy tham chiếu tới dịch vụ
// chống bot production hoặc công cụ né phát hiện bot.
//
// Phạm vi quét: harness (src/, scripts/, test/, public/, dashboard/).
// sim/ KHÔNG thuộc phạm vi harness — đó là prototype cũ của người dùng, tách riêng.

import { readFileSync, readdirSync, statSync, type Stats } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const SCAN_DIRS = ['src', 'test', 'public', 'dashboard'];
// scripts/: chỉ script thuộc harness nằm trong phạm vi. Các smoke-*/bench-* là
// công cụ phía agent (đi tới trang demo Google như agent/, vốn không bị quét).
const SCAN_FILES = [
  'package.json',
  'scripts/verify-assets.ts',
  'scripts/lint-boundaries.ts',
  'scripts/gen-assets.ts',
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'runs', 'dist', 'coverage', '.pnpm']);

/**
 * Bị cấm: dịch vụ chống bot production + công cụ né phát hiện bot.
 * Ghép từ mảnh để chính file này không chứa nguyên văn từ khoá — nếu viết thẳng,
 * lint sẽ tự bắt mình và không bao giờ xanh được.
 */
const BLOCKED: readonly string[] = [
  ['recap', 'tcha'],
  ['hcap', 'tcha'],
  ['turn', 'stile'],
  ['funcap', 'tcha'],
  ['proxy', '-chain'],
  ['puppeteer-extra-plugin-', 'stealth'],
  ['playwright', '-extra'],
].map((parts) => parts.join(''));

const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.html']);

interface Hit {
  file: string;
  line: number;
  term: string;
  text: string;
}

const walk = (dir: string, out: string[]): void => {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    let st: Stats;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
};

const collect = (): string[] => {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), files);
  for (const f of SCAN_FILES) {
    const full = path.join(ROOT, f);
    try {
      if (statSync(full).isFile()) files.push(full);
    } catch {
      /* không có thì bỏ qua */
    }
  }
  return files;
};

const scan = (files: string[]): Hit[] => {
  const hits: Hit[] = [];
  for (const file of files) {
    if (!TEXT_EXT.has(path.extname(file).toLowerCase())) continue;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === undefined) continue;
      const lower = line.toLowerCase();
      for (const term of BLOCKED) {
        if (lower.includes(term)) {
          hits.push({
            file: path.relative(ROOT, file),
            line: i + 1,
            term,
            text: line.trim().slice(0, 120),
          });
        }
      }
    }
  }
  return hits;
};

const files = collect();
const hits = scan(files);

if (hits.length === 0) {
  console.log(`lint:boundaries OK — ${files.length} file quét, 0 vi phạm`);
  process.exit(0);
}

console.error(`lint:boundaries FAIL — ${hits.length} vi phạm:`);
for (const hit of hits) {
  console.error(`  ${hit.file}:${hit.line}  [${hit.term}]  ${hit.text}`);
}
console.error('\nRanh giới dự án cấm mọi tham chiếu tới dịch vụ chống bot production');
console.error('và công cụ né phát hiện bot. Xem openspec/project.md mục "Ranh giới".');
process.exit(1);
