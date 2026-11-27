// Dashboard: WS client nhận event từ server, dựng panel challenge bên trái
// và log stream bên phải. Ring buffer replay do server đẩy trước khi live.

const MAX_LINES = 400;
const PANEL_LINGER_MS = 3000;

const panelsEl = document.getElementById('panels');
const terminalEl = document.getElementById('terminal');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const optSolver = document.getElementById('opt-solver');
const optHeadless = document.getElementById('opt-headless');
const hdrSolver = document.getElementById('hdr-solver');
const hdrRun = document.getElementById('hdr-run');
const hdrSolved = document.getElementById('hdr-solved');
const hdrFailed = document.getElementById('hdr-failed');

/** @type {Map<number, {root: HTMLElement, badge: HTMLElement, foot: HTMLElement, overlay: HTMLElement, cols: number, rows: number}>} */
const panels = new Map();

const fmtTs = (ts) => {
  const d = new Date(ts);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const addLine = (status, message, ts) => {
  const line = document.createElement('div');
  line.className = 'line';
  const tsEl = document.createElement('span');
  tsEl.className = 'ts';
  tsEl.textContent = fmtTs(ts ?? Date.now());
  const stEl = document.createElement('span');
  stEl.className = `st ${status}`;
  stEl.textContent = status;
  const msgEl = document.createElement('span');
  msgEl.className = 'msg';
  msgEl.textContent = message;
  line.append(tsEl, stEl, msgEl);
  terminalEl.append(line);
  while (terminalEl.childElementCount > MAX_LINES) terminalEl.firstElementChild?.remove();
  terminalEl.scrollTop = terminalEl.scrollHeight;
};

const clearTerminal = () => {
  terminalEl.replaceChildren();
};

const setRunning = (running) => {
  btnStart.disabled = running;
  btnStop.disabled = !running;
  hdrRun.textContent = `run: ${running ? 'live' : 'idle'}`;
};

const removePanelSoon = (index) => {
  const panel = panels.get(index);
  if (!panel) return;
  panels.delete(index);
  setTimeout(() => panel.root.remove(), PANEL_LINGER_MS);
};

const renderChallenge = (ev) => {
  const root = document.createElement('div');
  root.className = 'panel';

  const head = document.createElement('div');
  head.className = 'panel-head';
  const idx = document.createElement('span');
  idx.className = 'idx';
  idx.textContent = `#${String(ev.index).padStart(3, '0')}`;
  const badge = document.createElement('span');
  badge.className = 'badge SPAWNED';
  badge.textContent = 'SPAWNED';
  head.append(idx, badge);

  const instruction = document.createElement('div');
  instruction.className = 'panel-instruction';
  instruction.textContent = ev.instruction;

  const wrap = document.createElement('div');
  wrap.className = 'grid-wrap';
  const img = document.createElement('img');
  img.src = `data:image/jpeg;base64,${ev.imageBase64}`;
  img.alt = ev.instruction;
  const overlay = document.createElement('div');
  overlay.className = 'grid-overlay';
  overlay.style.gridTemplateColumns = `repeat(${ev.cols}, 1fr)`;
  overlay.style.gridTemplateRows = `repeat(${ev.rows}, 1fr)`;
  for (let i = 0; i < ev.cols * ev.rows; i += 1) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.tile = String(i);
    overlay.append(cell);
  }
  wrap.append(img, overlay);

  const foot = document.createElement('div');
  foot.className = 'panel-foot';
  foot.textContent = `${ev.cols}×${ev.rows}`;

  root.append(head, instruction, wrap, foot);
  panelsEl.prepend(root);
  panels.set(ev.index, { root, badge, foot, overlay, cols: ev.cols, rows: ev.rows });
};

const activePanel = () => {
  let best = null;
  let bestIdx = -1;
  for (const [index, panel] of panels) {
    if (index > bestIdx) {
      bestIdx = index;
      best = panel;
    }
  }
  return best;
};

const onEvent = (ev) => {
  switch (ev.type) {
    case 'challenge':
      renderChallenge(ev);
      addLine('FETCHING', `challenge #${ev.index} · ${ev.instruction}`, Date.now());
      break;

    case 'click': {
      const panel = activePanel();
      if (!panel) break;
      const cell = panel.overlay.querySelector(`[data-tile="${ev.tile}"]`);
      if (cell) cell.classList.add('clicked');
      break;
    }

    case 'log': {
      const panel = activePanel();
      if (panel && ev.status !== 'INFO' && ev.status !== 'NET') {
        panel.badge.className = `badge ${ev.status}`;
        panel.badge.textContent = ev.status;
        if (ev.status === 'COMPLETE') panel.root.classList.add('done');
        if (ev.status === 'FAILED') panel.root.classList.add('failed');
      }
      const suffix = ev.net ? ` · ${ev.net.host} · ${ev.net.latencyMs}ms` : '';
      addLine(ev.status, `${ev.message}${suffix}`, ev.ts);
      break;
    }

    case 'result': {
      const panel = activePanel();
      if (panel) {
        panel.badge.className = `badge ${ev.solved ? 'COMPLETE' : 'FAILED'}`;
        panel.badge.textContent = ev.solved ? 'COMPLETE' : 'FAILED';
        panel.root.classList.add(ev.solved ? 'done' : 'failed');
        panel.foot.textContent = `${ev.reason} · ${ev.durationMs}ms · ${ev.challenges} challenge`;
        removePanelSoon(ev.index ?? -1);
      }
      addLine(ev.solved ? 'COMPLETE' : 'FAILED', `${ev.reason} (${ev.durationMs}ms, ${ev.challenges} challenge)`, Date.now());
      break;
    }

    case 'stats':
      setRunning(ev.running);
      hdrSolver.textContent = `solver: ${ev.solver}`;
      hdrSolved.textContent = `solved: ${ev.solved}`;
      hdrFailed.textContent = `failed: ${ev.failed}`;
      break;

    default:
      break;
  }
};

const connect = () => {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.addEventListener('message', (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch {
      /* event hỏng thì bỏ qua, không giết stream */
    }
  });
  ws.addEventListener('close', () => {
    addLine('INFO', 'mất kết nối WS — thử lại sau 1.5s', Date.now());
    setTimeout(() => {
      clearTerminal();
      connect();
    }, 1500);
  });
};

btnStart.addEventListener('click', async () => {
  btnStart.disabled = true;
  clearTerminal();
  panelsEl.replaceChildren();
  panels.clear();
  try {
    const res = await fetch('/api/run/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ solver: optSolver.value, headless: optHeadless.checked }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      addLine('FAILED', body.error ?? `HTTP ${res.status}`, Date.now());
      btnStart.disabled = false;
    }
  } catch (err) {
    addLine('FAILED', String(err), Date.now());
    btnStart.disabled = false;
  }
});

btnStop.addEventListener('click', async () => {
  btnStop.disabled = true;
  try {
    const res = await fetch('/api/run/stop', { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      addLine('INFO', body.error ?? `HTTP ${res.status}`, Date.now());
      btnStop.disabled = false;
    }
  } catch (err) {
    addLine('FAILED', String(err), Date.now());
    btnStop.disabled = false;
  }
});

optSolver.addEventListener('change', () => {
  hdrSolver.textContent = `solver: ${optSolver.value}`;
});

addLine('INFO', 'kết nối tới server…', Date.now());
connect();