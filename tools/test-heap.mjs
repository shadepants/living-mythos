// Frame-loop allocation check in the real app: forced GC before/after a busy stretch (monsoon rain, particles, sculpting,
// villagers, audio) must show no meaningful heap growth (spec: zero GC in the frame loop).
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import puppeteer from 'puppeteer-core';

// Mesa llvmpipe is the software GL that stays alive in this PRoot (SwiftShader segfaults within ~1 s).
process.env.LIBGL_ALWAYS_SOFTWARE = '1'; process.env.GALLIUM_DRIVER = 'llvmpipe';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(homedir(), '.cache/ms-playwright');
const exe = join(base, readdirSync(base).find(d => d.startsWith('chromium_headless_shell')), 'chrome-headless-shell-linux-arm64/chrome-headless-shell');
const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(readFileSync(resolve(root, 'dist/index.html'))); }).listen(0);
const browser = await puppeteer.launch({ executablePath: exe, headless: 'shell', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--js-flags=--expose-gc', '--enable-precise-memory-info', '--window-size=900,600'] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 600 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
for (let n = 0; n < 8; n++) {
  await page.goto(`http://localhost:${server.address().port}/?debug=1&norender=1&fresh=1`, { waitUntil: 'load' });
  try { await page.waitForFunction(() => window.__mythos, { timeout: 12000 }); break; } catch (e) { if (n === 7) throw e; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? '  — ' + d : ''}`); if (!ok) failed++; };

await page.evaluate(() => { window.__mythos.atmo.setTarget(1); });     // monsoon: rain particles, wind, wet shaders
await page.mouse.move(450, 280);
await page.mouse.down();                                               // sculpt while everything runs
await sleep(2500);                                                      // warm up: pools, JIT, audio graph
const heap = () => page.evaluate(() => { window.gc(); window.gc(); return performance.memory.usedJSHeapSize; });
const frames0 = await page.evaluate(() => window.__mythos.world.stats.substeps);
const h0 = await heap();
await sleep(6000);
const h1 = await heap();
const frames1 = await page.evaluate(() => window.__mythos.world.stats.substeps);
await page.mouse.up();
const grew = (h1 - h0) / 1024;
check('the sim ran during the measurement', frames1 - frames0 > 100, `${frames1 - frames0} substeps`);
check('frame loop allocates (almost) nothing: heap growth over 6 s of rain + sculpting + audio < 1.5 MB', grew < 1536, `${grew.toFixed(0)} KB (${((h1 - h0) / 6 / 1024).toFixed(0)} KB/s)`);
await browser.close(); server.close();
if (errors.length) { console.error(errors.join('\n')); failed++; }
if (failed) process.exit(1);
console.log('heap test passed');
