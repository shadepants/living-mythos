// Renders the real audio engine offline (OfflineAudioContext in headless Chrome) for a scripted scene and measures it:
// clipping, loudness, stereo balance, silence, NaNs, reverb tail decay, and the environment bed on its own.
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import puppeteer from 'puppeteer-core';
process.env.LIBGL_ALWAYS_SOFTWARE = '1'; process.env.GALLIUM_DRIVER = 'llvmpipe';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(homedir(), '.cache/ms-playwright');
const exe = join(base, readdirSync(base).find(d => d.startsWith('chromium_headless_shell')), 'chrome-headless-shell-linux-arm64/chrome-headless-shell');
const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(readFileSync(resolve(root, 'dist/index.html'))); }).listen(0);
const browser = await puppeteer.launch({ executablePath: exe, headless: 'shell', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--window-size=600,400'] });
const page = await browser.newPage();
await page.goto(`http://localhost:${server.address().port}/?debug=1&norender=1&fresh=1`);
await page.waitForFunction(() => window.__mythos, { timeout: 60000 });

const result = await page.evaluate(async () => {
  const { createAudioEngine, SCALES, degreeFreq, semiFreq, TIMBRE } = window.__mythos.mods;
  const SR = 44100;
  const stats = (buf, from, to) => {
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let peak = 0, sl = 0, sr = 0, nan = 0, clip = 0;
    const a = Math.floor(from * SR), b = Math.min(L.length, Math.floor(to * SR));
    for (let i = a; i < b; i++) { const l = L[i], r = R[i]; if (!Number.isFinite(l) || !Number.isFinite(r)) { nan++; continue; } const m = Math.max(Math.abs(l), Math.abs(r)); if (m > peak) peak = m; if (m >= 0.999) clip++; sl += l * l; sr += r * r; }
    const n = Math.max(1, b - a);
    const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
    return { peak, peakDb: db(peak), rmsLDb: db(Math.sqrt(sl / n)), rmsRDb: db(Math.sqrt(sr / n)), nan, clip };
  };
  const render = async (build, seconds) => {
    const ctx = new OfflineAudioContext(2, SR * seconds, SR);
    const eng = createAudioEngine(() => ctx);
    eng.ensure();
    build(eng, SCALES[1]);
    const buf = await ctx.startRendering();
    return buf;
  };
  const env = { wind: 0.5, windSpeed: 0.2, flux: 0.6, sculpt: 0.0, night: 0.0, aurora: 0 };
  const out = {};

  // 1) environment bed alone (wind + river + a little rumble)
  const bed = await render((eng) => { eng.update(0.1, { ...env, sculpt: 0.1 }); }, 6);
  out.bed = stats(bed, 2, 6);

  // 2) a busy musical scene on top of the bed: plucks, a chord, bell arpeggios, 25 simultaneous notes (steals voices)
  const scene = await render((eng, sc) => {
    eng.update(0.1, env);
    let k = 0;
    const play = (f, v, tim, d) => { if (k % 8 === 0) eng.update(0.1, env); k++; eng.trigger(f, v, tim, (k % 2 ? -0.6 : 0.6), d); };
    for (let i = 0; i < 12; i++) play(degreeFreq(sc, 2 + (i % 5), 0), 0.8, TIMBRE.marimba, 0.5 + i * 0.25);
    play(semiFreq(sc, 0, 0), 0.8, TIMBRE.warm, 3.6); play(semiFreq(sc, 7, 0), 0.7, TIMBRE.warm, 3.62); play(semiFreq(sc, 12, 0), 0.6, TIMBRE.warm, 3.64);
    for (let i = 0; i < 4; i++) play(degreeFreq(sc, 5 + i * 2, 0), 0.5, TIMBRE.bell, 4.4 + i * 0.09);
    for (let i = 0; i < 25; i++) play(degreeFreq(sc, i % 9, 0), 1.0, TIMBRE.kalimba, 5.6);   // worst case: everything at once
  }, 12);
  out.sceneAll = stats(scene, 0, 12);
  out.sceneBurst = stats(scene, 5.5, 6.5);
  out.tail = stats(scene, 10, 12);      // after the last note: reverb tail + bed only
  out.earlyBed = stats(scene, 0, 0.4);
  const rms = (s) => (s.rmsLDb + s.rmsRDb) / 2;
  out.musicOverBedDb = rms(stats(scene, 0.6, 3.4)) - rms(out.bed);
  return out;
});
await browser.close(); server.close();

let failed = 0;
const check = (name, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? '  — ' + d : ''}`); if (!ok) failed++; };
const f = (x) => x.toFixed(1);
const r = result;
console.log(`      bed: peak ${f(r.bed.peakDb)} dBFS, rms L/R ${f(r.bed.rmsLDb)}/${f(r.bed.rmsRDb)} dB | scene: peak ${f(r.sceneAll.peakDb)} dBFS, burst peak ${f(r.sceneBurst.peakDb)} dBFS | tail rms ${f(r.tail.rmsLDb)} dB | music over bed ${f(r.musicOverBedDb)} dB`);
check('no NaN/Inf samples anywhere', r.bed.nan + r.sceneAll.nan === 0);
check('the environment bed is audible but quiet (rms between -60 and -22 dBFS)', r.bed.rmsLDb > -60 && r.bed.rmsLDb < -22 && r.bed.rmsRDb > -60 && r.bed.rmsRDb < -22, `${f(r.bed.rmsLDb)} / ${f(r.bed.rmsRDb)} dB`);
check('wind/river bed is balanced left-right (within 3 dB)', Math.abs(r.bed.rmsLDb - r.bed.rmsRDb) < 3);
check('the busy scene never clips (peak below -0.5 dBFS)', r.sceneAll.peakDb < -0.5 && r.sceneAll.clip === 0, `peak ${f(r.sceneAll.peakDb)} dBFS`);
check('worst case (25 notes at once, all voices stolen) still does not clip', r.sceneBurst.peakDb < -0.5, `${f(r.sceneBurst.peakDb)} dBFS`);
check('music sits clearly above the bed (6-30 dB) without drowning it', r.musicOverBedDb > 6 && r.musicOverBedDb < 30, `${f(r.musicOverBedDb)} dB`);
check('after the last note the reverb tail fades toward the bed (>8 dB quieter than the burst)', r.tail.rmsLDb < r.sceneBurst.rmsLDb - 8, `tail ${f(r.tail.rmsLDb)} vs burst ${f(r.sceneBurst.rmsLDb)} dB`);
check('the first 0.4 s (before any note) is only the quiet bed (no pops)', r.earlyBed.peakDb < -20, `${f(r.earlyBed.peakDb)} dBFS`);
if (failed) { console.error(`\n${failed} audio render check(s) failed`); process.exit(1); }
console.log('\naudio render checks passed');
