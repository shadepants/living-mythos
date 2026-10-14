// Render the built app on Mesa llvmpipe (software GL that survives here, unlike SwiftShader) and save a PNG.
// Usage: node tools/snap.mjs out.png [--query "atmo=0.5"] [--wait 4] [--w 900] [--h 600] [--eval "js to run first"]
import http from 'node:http';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || '/tmp/snap.png';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const query = arg('query', ''), wait = +arg('wait', 4), W = +arg('w', 900), H = +arg('h', 600), pre = arg('eval', '');
const base = join(homedir(), '.cache/ms-playwright');
const exe = join(base, readdirSync(base).find(d => d.startsWith('chromium_headless_shell')), 'chrome-headless-shell-linux-arm64/chrome-headless-shell');
const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(readFileSync(resolve(root, 'dist/index.html'))); }).listen(0);
process.env.LIBGL_ALWAYS_SOFTWARE = '1'; process.env.GALLIUM_DRIVER = 'llvmpipe';
const browser = await puppeteer.launch({ executablePath: exe, headless: 'shell', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync', `--window-size=${W},${H}`] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 500)); });
let url = null;
for (let n = 0; n < 4 && !url; n++) {
  await page.goto(`http://localhost:${server.address().port}/?debug=1&fresh=1&${query}`, { waitUntil: 'load' });
  try { await page.waitForFunction(() => window.__mythos, { timeout: 30000 }); } catch (e) { continue; }
  if (pre) await page.evaluate(pre);
  await new Promise(r => setTimeout(r, wait * 1000));
  url = await page.evaluate(() => { const gl = document.getElementById('stage').getContext('webgl2'); if (!gl || gl.isContextLost()) return null; return window.__mythos.snapshot(); }).catch(() => null);
}
await browser.close(); server.close();
if (!url) { console.error('no frame captured'); process.exit(1); }
writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log('saved', out);
