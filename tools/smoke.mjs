// Headless smoke test: serves dist/, loads it in chrome-headless-shell and collects console/page errors.
// NOTE: in this PRoot the SwiftShader GPU process segfaults ~1s after the first draw, so there are no
// screenshots; but shader compile/link errors and JS exceptions surface before that, which is what this checks.
// Usage: node tools/smoke.mjs [--secs 4] [--query "debug=1"] [--eval "js"] [--file dist/index.html]
import http from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const secs = +arg('secs', 4), query = arg('query', ''), evalJs = arg('eval', '');
const width = +arg('w', 800), height = +arg('h', 500);

const base = join(homedir(), '.cache/ms-playwright');
const dir = readdirSync(base).find(d => d.startsWith('chromium_headless_shell'));
const exe = join(base, dir, 'chrome-headless-shell-linux-arm64/chrome-headless-shell');
if (!existsSync(exe)) { console.error('no headless chrome at', exe); process.exit(2); }

const expectPrograms = +arg('expect', 0);
const attemptsMax = +arg('attempts', 8);

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(readFileSync(resolve(root, arg('file', 'dist/index.html'))));
}).listen(0);
const port = server.address().port;
const extra = (process.env.CHROME_FLAGS || '').split(' ').filter(Boolean);

// One launch. The GPU process can die early in this PRoot, so a launch only counts as a real check if the
// app got far enough to log "programs compiled: N" (all shaders compiled) before that happened.
async function attempt() {
  const browser = await puppeteer.launch({
    executablePath: exe, headless: 'shell', dumpio: !!process.env.DUMPIO,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', `--window-size=${width},${height}`, ...extra],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const errors = [];
  let programs = -1;
  page.on('console', m => {
    const t = m.type(), txt = m.text();
    if (t === 'error' || t === 'warning' || txt.startsWith('[mythos]')) console.log(`[console.${t}]`, txt);
    if (t === 'error') errors.push(txt);
    const mm = txt.match(/programs compiled: (\d+)/);
    if (mm) programs = +mm[1];
  });
  page.on('pageerror', e => { console.log('[pageerror]', e.message); errors.push(e.message); });
  await page.goto(`http://localhost:${port}/?${query}`, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, secs * 1000));
  let ev;
  if (evalJs) ev = await page.evaluate(evalJs).catch(e => 'eval failed: ' + e.message);
  await browser.close();
  return { errors, programs, ev };
}

let result = null;
for (let n = 1; n <= attemptsMax; n++) {
  result = await attempt();
  if (result.errors.length || result.programs >= 0) break;
  console.log(`[smoke] attempt ${n}: GPU process died before first frame, retrying`);
}
server.close();
if (evalJs && result.ev !== undefined) console.log('[eval]', JSON.stringify(result.ev));
if (result.errors.length) { console.error(`SMOKE FAILED: ${result.errors.length} error(s)`); process.exit(1); }
if (result.programs < 0) { console.error('SMOKE INCONCLUSIVE: never reached the first frame'); process.exit(3); }
if (expectPrograms && result.programs !== expectPrograms) { console.error(`SMOKE FAILED: expected ${expectPrograms} programs, got ${result.programs}`); process.exit(1); }
console.log(`smoke ok (${result.programs} programs compiled, no errors)`);
