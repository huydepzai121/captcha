// language: TypeScript, file: agent/testbed/server.ts, runtime: Node 22
// Trang test local LUÔN bắt giải captcha (sitekey test của Google luôn thả
// challenge), kèm panel in các dấu vết bị soi. Chạy: npm run testbed
// Rồi: npm run agent -- --headful --target http://127.0.0.1:3400/
//
// Vì sao có trang này: trang demo thật thường pass thẳng khi profile đã được
// Google tin, nên không kiểm tra được gì. Sitekey dưới đây luôn thả challenge.

import { createServer } from 'node:http';

const PORT = 3400;
/** Sitekey test chính thức của Google: luôn yêu cầu giải. */
const ALWAYS_CHALLENGE_SITEKEY = '6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-';

const PAGE = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8" />
<title>testbed — captcha luôn bắt giải</title>
<style>
  body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:28px;background:#f6f7f9;color:#202124}
  .card{max-width:720px;margin:0 auto;background:#fff;border:1px solid #d0d7de;border-radius:10px;overflow:hidden}
  h1{font-size:17px;margin:0;padding:14px 18px;background:#1a73e8;color:#fff}
  .body{padding:18px}
  .row{display:grid;grid-template-columns:170px 1fr;gap:8px;padding:5px 0;border-bottom:1px dashed #e6e6e6;font-family:ui-monospace,monospace;font-size:12px}
  .k{color:#5f6368}
  .v{word-break:break-all}
  .flag{font-weight:600}
  .bad{color:#c5221f}
  .ok{color:#137333}
  #done{margin-top:14px;font-weight:600;color:#137333}
  .wrap{margin:18px 0}
</style></head>
<body>
<div class="card">
  <h1>Trang test — captcha luôn bắt giải</h1>
  <div class="body">
    <p>Sitekey test của Google, luôn thả challenge. Dùng để đo xem automation có bị soi không.</p>
    <div class="wrap"><div class="g-recaptcha" data-sitekey="${ALWAYS_CHALLENGE_SITEKEY}" data-callback="onPass"></div></div>
    <div id="done"></div>
    <h2 style="font-size:14px">Dấu vết nhìn thấy được từ trong trang</h2>
    <div id="fp"></div>
  </div>
</div>
<script src="https://www.google.com/recaptcha/api.js" async defer></script>
<script>
  function onPass(){ document.getElementById('done').textContent = 'ĐÃ GIẢI XONG'; }
  const rows = [
    ['navigator.webdriver', String(navigator.webdriver)],
    ['userAgent', navigator.userAgent],
    ['platform', navigator.platform],
    ['languages', (navigator.languages||[]).join(', ')],
    ['plugins', String(navigator.plugins.length)],
    ['hardwareConcurrency', String(navigator.hardwareConcurrency)],
    ['deviceMemory', String(navigator.deviceMemory)],
    ['timezone', Intl.DateTimeFormat().resolvedOptions().timeZone],
    ['window size', innerWidth + 'x' + innerHeight],
    ['screen', screen.width + 'x' + screen.height + ' @' + screen.colorDepth],
    ['chrome object', typeof window.chrome],
    ['webgl vendor', (() => { try { const g = document.createElement('canvas').getContext('webgl'); const d = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(d.UNMASKED_VENDOR_WEBGL); } catch { return 'n/a'; } })()],
    ['webgl renderer', (() => { try { const g = document.createElement('canvas').getContext('webgl'); const d = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(d.UNMASKED_RENDERER_WEBGL); } catch { return 'n/a'; } })()],
  ];
  const fp = document.getElementById('fp');
  for (const [k, v] of rows) {
    const r = document.createElement('div'); r.className = 'row';
    const kk = document.createElement('div'); kk.className = 'k'; kk.textContent = k;
    const vv = document.createElement('div');
    const suspicious = k === 'navigator.webdriver' && v === 'true';
    vv.className = 'v' + (k === 'navigator.webdriver' && v === 'false' ? ' ok flag' : suspicious ? ' bad flag' : '');
    vv.textContent = v;
    r.append(kk, vv); fp.append(r);
  }
</script>
</body></html>`;

/**
 * Trang hCaptcha. Hai sitekey test chính thức: `...0001` luôn cho qua,
 * `...0002` luôn bắt giải. Mặc định dùng `...0002` vì mục đích là để phải giải.
 */
const HCAPTCHA_PAGE = (sitekey: string): string => `<!doctype html>
<html lang="vi"><head><meta charset="utf-8" />
<title>testbed — hCaptcha</title>
<style>
  body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:28px;background:#f6f7f9;color:#202124}
  .card{max-width:720px;margin:0 auto;background:#fff;border:1px solid #d0d7de;border-radius:10px;overflow:hidden}
  h1{font-size:17px;margin:0;padding:14px 18px;background:#0f6ad2;color:#fff}
  .body{padding:18px}
  #done{margin-top:14px;font-weight:600;color:#137333}
</style></head>
<body>
<div class="card">
  <h1>Trang test — hCaptcha luôn bắt giải</h1>
  <div class="body">
    <p>Sitekey test của hCaptcha, luôn thả challenge.</p>
    <div class="h-captcha" data-sitekey="${sitekey}" data-callback="onPass"></div>
    <div id="done"></div>
  </div>
</div>
<script>
  function onPass(){ document.getElementById('done').textContent = 'ĐÃ GIẢI XONG'; }
</script>
<script src="https://js.hcaptcha.com/1/api.js" async defer></script>
</body></html>`;

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === '/hcaptcha') {
    const key = url.searchParams.get('sitekey') ?? '10000000-ffff-ffff-ffff-000000000002';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(HCAPTCHA_PAGE(key));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[testbed] http://127.0.0.1:${PORT}/ — reCAPTCHA luôn bắt giải`);
  console.log(`[testbed] http://127.0.0.1:${PORT}/hcaptcha — hCaptcha luôn bắt giải`);
});
