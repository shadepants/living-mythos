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

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(readFileSync(resolve(root, arg('file', 'dist/index.html'))));
}).listen(0);
const port = server.address().port;

const extra = (process.env.CHROME_FLAGS || '').split(' ').filter(Boolean);
const browser = await puppeteer.launch({
  executablePath: exe, headless: 'shell', dumpio: !!process.env.DUMPIO,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', `--window-size=${width},${height}`, ...extra],
});
const page = await browser.newPage();
await page.setViewport({ width, height });
const errors = [];
page.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning' || m.text().startsWith('[mythos]')) console.log(`[console.${t}]`, m.text()); if (t === 'error') errors.push(m.text()); });
page.on('pageerror', e => { console.log('[pageerror]', e.message); errors.push(e.message); });
await page.goto(`http://localhost:${port}/?${query}`, { waitUntil: 'load', timeout: 60000 });
await new Promise(r => setTimeout(r, secs * 1000));
if (evalJs) console.log('[eval]', JSON.stringify(await page.evaluate(evalJs)));
await browser.close();
server.close();
if (errors.length) { console.error(`SMOKE FAILED: ${errors.length} error(s)`); process.exit(1); }
console.log('smoke ok');
