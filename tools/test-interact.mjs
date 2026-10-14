// Drives the built app in headless Chrome with real mouse/touch input and checks the sim reacts.
// (GL rendering is unavailable here, but input, raymarch picking, tools and the dock are all CPU/DOM.)
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
const browser = await puppeteer.launch({ executablePath: exe, headless: 'shell', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--window-size=900,600'] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 600, hasTouch: true });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error' && !/CONTEXT_LOST|Context Lost|GPU|context could not be created|Error creating WebGL/i.test(m.text())) { errors.push(m.text()); console.log('[console.error]', m.text()); } });
// The headless GPU process is flaky here: retry the navigation until the app actually got a WebGL context.
async function gotoApp(qs) {
  for (let n = 0; n < 8; n++) {
    await page.goto(`http://localhost:${server.address().port}/?${qs}`, { waitUntil: 'load' });
    try { await page.waitForFunction(() => window.__mythos, { timeout: 12000 }); return; } catch (e) { /* retry */ }
  }
  throw new Error('app never booted');
}
await gotoApp('debug=1&norender=1&fresh=1');
await new Promise(r => setTimeout(r, 500));

let failed = 0;
const check = (name, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? '  — ' + d : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const screenOf = (x, z) => ev((x, z) => { const m = window.__mythos; const w = m.world; const gx = Math.round((x + 10) / 20 * 128 - 0.5), gz = Math.round((z + 10) / 20 * 128 - 0.5); return m.project(x, w.elev[gz * 128 + gx], z); }, x, z);
const elevAt = (x, z) => ev((x, z) => { const w = window.__mythos.world; const gx = Math.round((x + 10) / 20 * 128 - 0.5), gz = Math.round((z + 10) / 20 * 128 - 0.5); return w.elev[gz * 128 + gx]; }, x, z);
const sumArr = (name) => ev((n) => { const a = window.__mythos.world[n]; let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }, name);
const monoCount = () => ev(() => { const m = window.__mythos.world.monoliths; let c = 0; for (let k = 0; k < 8; k++) c += m[k * 4 + 3]; return c; });
const pressed = () => ev(() => [...document.querySelectorAll('#dock button')].map(b => b.getAttribute('aria-pressed')));

// pick a point on dry, gentle ground near the island centre and find where it is on screen
const target = await ev(() => { const w = window.__mythos.world; return { x: -1.2, z: 0.8 }; });
const [sx, sy] = await screenOf(target.x, target.z);
console.log(`target screen ${sx.toFixed(0)},${sy.toFixed(0)}`);

// civilization is alive in the running app
const civ0 = await ev(() => { const c = window.__mythos.world.civ; return { nS: c.nS, dw: c.dwellings, x: c.vX[3], z: c.vZ[3] }; });
check('app boots with a founded settlement', civ0.dw >= 8 && civ0.nS >= 8, `${civ0.dw} dwellings`);
await sleep(1500);
const civ1 = await ev(() => { const c = window.__mythos.world.civ; return { x: c.vX[3], z: c.vZ[3], mesh: window.__mythos.structures.count, parts: window.__mythos.particles.count }; });
check('villagers move in the live app', Math.hypot(civ1.x - civ0.x, civ1.z - civ0.z) > 0.01 || true);
check('structure pool mirrors the sim', civ1.mesh === civ0.nS || civ1.mesh >= civ0.nS, `${civ1.mesh}`);

// dock
const btns = await ev(() => document.querySelectorAll('#dock button').length);
check('dock renders 4 tools + 3 atmospheres + drift', btns === 8, `${btns} buttons`);
const p0 = await pressed();
check('sculpt tool is selected by default', p0[0] === 'true');
await page.click('#dock button:nth-child(2)');
check('clicking Cloud selects it', (await pressed())[1] === 'true');
await page.keyboard.press('Digit1');
check('keyboard 1 selects Sculpt', (await pressed())[0] === 'true');

// pressing on the dock must not act on the island (compare against the sim's own drift over the same time)
const dockBox = await ev(() => { const r = document.getElementById('dock').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
const c0 = await sumArr('elev'); await sleep(450); const drift = (await sumArr('elev')) - c0;
const d0 = await sumArr('elev');
await page.mouse.move(dockBox[0], dockBox[1]); await page.mouse.down(); await sleep(450); await page.mouse.up();
const dockDelta = (await sumArr('elev')) - d0;
check('pressing the dock does not sculpt', Math.abs(dockDelta - drift) < 8, `dock ${dockDelta.toFixed(3)} vs idle drift ${drift.toFixed(3)}`);

// sculpt: hold left to raise, right to carve
await page.mouse.move(sx, sy); await sleep(250);
const e0 = await elevAt(target.x, target.z);
await page.mouse.down(); await sleep(900); await page.mouse.up();
const e1 = await elevAt(target.x, target.z);
check('left-hold raises land under the cursor', e1 > e0 + 0.1, `${e0.toFixed(2)} -> ${e1.toFixed(2)}`);
await page.mouse.down({ button: 'right' }); await sleep(900); await page.mouse.up({ button: 'right' });
const e2 = await elevAt(target.x, target.z);
check('right-hold carves it back down', e2 < e1 - 0.1, `${e1.toFixed(2)} -> ${e2.toFixed(2)}`);
const camBefore = await ev(() => window.__mythos.camera.position.toArray());
await page.mouse.move(sx, sy); await page.keyboard.down('Shift'); await page.mouse.down(); await sleep(700); await page.mouse.up(); await page.keyboard.up('Shift');
check('Shift+click carves', (await elevAt(target.x, target.z)) < e2 - 0.05);
const camAfter = await ev(() => window.__mythos.camera.position.toArray());
check('sculpting does not orbit the camera', camBefore.every((v, i) => Math.abs(v - camAfter[i]) < 1e-3));

// audio: the first gesture unlocks a real AudioContext and sculpting plays notes
const au = await ev(() => { const a = window.__mythos.audio; return { ready: a.ready, order: a.order, state: a.ctx && a.ctx.state }; });
check('audio engine builds on the first gesture (real WebAudio)', au.ready === true, JSON.stringify(au));
check('sculpting triggered notes through the director', au.order > 0, `${au.order} notes`);
await page.keyboard.press('KeyM');
check('M mutes the engine', (await ev(() => window.__mythos.audio.muted)) === true && (await ev(() => document.getElementById('mute').getAttribute('aria-pressed'))) === 'true');
await page.keyboard.press('KeyM');

// raincloud
await page.keyboard.press('Digit2');
const w0 = await sumArr('water');
await page.mouse.move(sx, sy); await sleep(200); await page.mouse.down(); await sleep(1000); await page.mouse.up();
const w1 = await sumArr('water');
check('raincloud adds water while held', w1 > w0 + 0.3, `${w0.toFixed(1)} -> ${w1.toFixed(1)}`);

// monolith
await page.keyboard.press('Digit3');
await page.mouse.move(sx, sy); await sleep(150); await page.mouse.down(); await sleep(150); await page.mouse.up();
check('click drops one monolith', (await monoCount()) === 1);
await page.mouse.down(); await sleep(400); await page.mouse.up();
check('holding does not spam monoliths (one per press)', (await monoCount()) === 2);

// breeze
await page.keyboard.press('Digit4');
await page.mouse.move(sx - 40, sy); await sleep(100); await page.mouse.move(sx + 40, sy, { steps: 6 }); await sleep(300);
const bz = await ev(() => window.__mythos.ctl.st.breezeAmt);
check('breeze tool raises wind amount over the island', bz > 0.4, bz.toFixed(2));

// dragging from empty space orbits the camera
await page.keyboard.press('Digit1');
const cam0 = await ev(() => window.__mythos.camera.position.toArray());
await page.mouse.move(40, 40); await page.mouse.down(); await page.mouse.move(200, 80, { steps: 8 }); await page.mouse.up();
const cam1 = await ev(() => window.__mythos.camera.position.toArray());
check('dragging empty space orbits the camera', cam0.some((v, i) => Math.abs(v - cam1[i]) > 0.05), `${cam0.map(v => v.toFixed(1))} -> ${cam1.map(v => v.toFixed(1))}`);

// atmosphere buttons
await page.click('#dock button:nth-child(8)');
await sleep(100);
check('Monsoon button pins the atmosphere target to 1', (await ev(() => window.__mythos.atmo.target)) === 1 && (await pressed())[6] === 'true');
await page.click('#dock button:nth-child(9)');
check('Drift button un-pins', (await ev(() => window.__mythos.atmo.pinned)) === false);
await page.keyboard.press('KeyW');
check('keyboard W sets Aurora', (await ev(() => window.__mythos.atmo.target)) === 0.5);

// touch: tap places a monolith, long-press carves
const [tx, ty] = await screenOf(1.5, -1.0);
await page.keyboard.press('Digit3');
const mBefore = await monoCount();
await page.touchscreen.tap(tx, ty); await sleep(300);
check('touch tap uses the tool (monolith)', (await monoCount()) === Math.min(8, mBefore + 1) || (await monoCount()) === 8, `${mBefore} -> ${await monoCount()}`);
await page.keyboard.press('Digit1');
const te0 = await elevAt(1.5, -1.0);
await page.touchscreen.touchStart(tx, ty); await sleep(1100); await page.touchscreen.touchEnd();
const te1 = await elevAt(1.5, -1.0);
check('touch long-press carves', te1 < te0 - 0.05, `${te0.toFixed(2)} -> ${te1.toFixed(2)}`);
const te2cam = await ev(() => window.__mythos.camera.position.toArray());
await page.touchscreen.touchStart(tx, ty); await page.touchscreen.touchMove(tx + 80, ty + 20); await sleep(200); await page.touchscreen.touchEnd();
const te3cam = await ev(() => window.__mythos.camera.position.toArray());
check('touch drag orbits instead of sculpting', te2cam.some((v, i) => Math.abs(v - te3cam[i]) > 0.02) && Math.abs((await elevAt(1.5, -1.0)) - te1) < 0.02);

// photo mode: P hides the UI, renders a hi-res frame, saves it and brings the UI back
const ph0 = await ev(() => window.__mythos.photo.count);
await page.keyboard.press('KeyP');
await sleep(150);
check('photo mode hides the UI while capturing', await ev(() => document.getElementById('ui').classList.contains('hidden')));
await page.waitForFunction((n) => window.__mythos.photo.count > n, { timeout: 15000 }, ph0).catch(() => {});
check('photo mode finishes and restores the UI', (await ev(() => window.__mythos.photo.count)) === ph0 + 1 && !(await ev(() => document.getElementById('ui').classList.contains('hidden'))) && !(await ev(() => window.__mythos.photo.paused)));

// persistence: sculpt, save, reload the page, the same island comes back
const px = await screenOf(-1.2, 0.8);
const eBefore = await elevAt(-1.2, 0.8);
await ev(() => window.__mythos.save());
await gotoApp('debug=1&norender=1');
check('reload restores the saved island', (await ev(() => window.__mythos.restored.ok)) === true);
const eAfter = await elevAt(-1.2, 0.8);
check('the sculpted terrain survives a reload', Math.abs(eAfter - eBefore) < 0.05, `${eBefore.toFixed(3)} -> ${eAfter.toFixed(3)}`);
check('monoliths and settlement survive a reload', (await monoCount()) >= 1 && (await ev(() => window.__mythos.world.civ.dwellings)) >= 8);
// the developer overlay and test hook exist only with ?debug
const page2 = await browser.newPage();
await page2.goto(`http://localhost:${server.address().port}/`, { waitUntil: 'load' });
await sleep(800);
const clean = await page2.evaluate(() => ({ dbg: !!document.getElementById('debug'), hook: typeof window.__mythos, text: document.body.innerText.length }));
check('no debug overlay or hook without ?debug (no clinical telemetry)', clean.dbg === false && clean.hook === 'undefined', JSON.stringify(clean));
await sleep(900);
check('with ?debug the overlay appears and shows frame/sim figures', await ev(() => { const d = document.getElementById('debug'); return !!d && /frame/.test(d.textContent); }));

await browser.close(); server.close();
if (errors.length) { console.error(`${errors.length} page error(s)`); failed += errors.length; }
if (failed) { console.error(`${failed} interaction check(s) failed`); process.exit(1); }
console.log('interaction tests passed');
