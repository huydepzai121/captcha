// language: TypeScript, file: src/server/render.ts, runtime: Node 22
// Trang challenge cho worker. KHÔNG chứa ground truth: chỉ instruction, ảnh, và
// các vùng click mang `data-tile-index` (spec challenge-server: "HTML không rò đáp án").

import type { Grid, Instruction } from './types.js';

export interface ChallengePageInput {
  id: string;
  instruction: string;
  grid: Grid;
  imageUrl: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const PAGE_CSS = `
:root{--line:#d0d7de;--accent:#1a73e8}
*{box-sizing:border-box}
body{margin:0;font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#202124;
     display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:20px}
.card{width:min(560px,100%);border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#f9f9f9}
.head{background:#1a73e8;color:#fff;padding:16px 18px}
.head .title{font-size:17px;font-weight:600}
.head .sub{font-size:12px;opacity:.85;margin-top:4px}
.body{padding:16px 18px 18px}
.grid-wrap{position:relative;margin:0 auto;width:fit-content}
.grid-wrap img{display:block;width:100%;height:auto;border-radius:4px}
.overlay{position:absolute;inset:0;display:grid}
.cell{position:relative;cursor:pointer;border:1px solid transparent}
.cell:hover{outline:2px solid rgba(26,115,232,.5);outline-offset:-2px}
.cell.on::after{content:"";position:absolute;inset:0;background:rgba(26,115,232,.42);
  box-shadow:inset 0 0 0 3px #1a73e8}
.foot{display:flex;align-items:center;gap:12px;margin-top:16px}
button{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:11px 26px;
  font:inherit;font-weight:600;cursor:pointer;letter-spacing:.02em}
button:disabled{opacity:.5;cursor:default}
.verdict{margin-left:auto;font-weight:600}
.verdict.ok{color:#137333}
.verdict.bad{color:#c5221f}
`;

const PAGE_JS = `
const wrap = document.querySelector('.overlay');
const btn = document.getElementById('verify');
const verdict = document.getElementById('verdict');
const selected = new Set();

wrap.addEventListener('click', (ev) => {
  const cell = ev.target.closest('.cell');
  if (!cell) return;
  const tile = Number(cell.dataset.tileIndex);
  if (selected.has(tile)) { selected.delete(tile); cell.classList.remove('on'); }
  else { selected.add(tile); cell.classList.add('on'); }
});

btn.addEventListener('click', async () => {
  btn.disabled = true;
  try {
    const res = await fetch('/api/challenges/' + encodeURIComponent(document.body.dataset.challengeId) + '/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selected: [...selected].sort((a, b) => a - b) }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      verdict.textContent = body.ok ? 'ĐÚNG' : 'SAI';
      verdict.className = 'verdict ' + (body.ok ? 'ok' : 'bad');
      document.dispatchEvent(new CustomEvent('challenge:verified', { detail: body }));
    } else {
      verdict.textContent = body.error || ('HTTP ' + res.status);
      verdict.className = 'verdict bad';
      document.dispatchEvent(new CustomEvent('challenge:verified', { detail: { ok: false, status: res.status } }));
    }
  } catch (err) {
    verdict.textContent = String(err);
    verdict.className = 'verdict bad';
  }
});
`;

export function renderChallengePage(input: ChallengePageInput): string {
  const { id, instruction, grid, imageUrl } = input;

  let cells = '';
  for (let i = 0; i < grid.cols * grid.rows; i += 1) {
    cells += `<div class="cell" data-tile-index="${i}"></div>`;
  }

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>challenge</title>
<style>${PAGE_CSS}</style>
</head>
<body data-challenge-id="${escapeHtml(id)}">
  <div class="card">
    <div class="head">
      <div class="title">${escapeHtml(instruction)}</div>
      <div class="sub">Chọn tất cả ô khớp, rồi bấm XÁC NHẬN</div>
    </div>
    <div class="body">
      <div class="grid-wrap">
        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(instruction)}" />
        <div class="overlay" style="grid-template-columns:repeat(${grid.cols},1fr);grid-template-rows:repeat(${grid.rows},1fr)">
          ${cells}
        </div>
      </div>
      <div class="foot">
        <button id="verify">XÁC NHẬN</button>
        <span class="verdict" id="verdict"></span>
      </div>
    </div>
  </div>
  <script>${PAGE_JS}</script>
</body>
</html>`;
}
