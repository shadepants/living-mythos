// Top-down preview of the sim (terrain, water, soil, structures, villagers) written as a PPM — a sanity view when no GPU is around.
// Usage: node tools/preview-map.mjs out.ppm [simSeconds]
import { writeFileSync } from 'node:fs';
import { createWorld } from '../src/sim/world.js';
import { simStep } from '../src/sim/sim.js';
import { prewarm } from '../src/sim/prewarm.js';
import { seedCivilization, KIND_DWELLING, KIND_MONOLITH, KIND_BRIDGE, KIND_STEPS, KIND_PAVING, KIND_MYTH } from '../src/sim/civ.js';
import { placeMonolith } from '../src/sim/tools.js';
import { slopeAtCell } from '../src/sim/civ.js';

const out = process.argv[2] || '/tmp/map.ppm';
const secs = +(process.argv[3] || 90);
const w = createWorld(1337); prewarm(w); seedCivilization(w);
if (process.argv.includes('--monolith')) placeMonolith(w, 2.5, 1.5);
for (let i = 0; i < secs * 40; i++) simStep(w);

const S = 4, N = 128, W = N * S;
const img = new Uint8Array(W * W * 3);
const put = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= W || y >= W) return; const o = (y * W + x) * 3; img[o] = r; img[o + 1] = g; img[o + 2] = b; };
const px = (wx) => Math.round((wx + 10) / 20 * W), mix = (a, b, t) => a + (b - a) * t;
for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
  const i = z * N + x;
  let r, g, b;
  if (w.mask[i]) { r = 20; g = 18; b = 30; }
  else {
    const e = w.elev[i], f = w.fertility[i], sl = slopeAtCell(w.elev, i);
    const h = Math.max(0, Math.min(1, e / 1.2));
    r = mix(150, 205, h); g = mix(102, 170, h); b = mix(72, 120, h);
    const fl = Math.max(0, Math.min(1, (f - 0.2) / 0.6));
    r = mix(r, 70, fl * 0.8); g = mix(g, 150, fl * 0.8); b = mix(b, 70, fl * 0.8);
    if (sl > 0.035) { r *= 0.62; g *= 0.62; b *= 0.66; }
    if (w.compaction[i] > 0.3) { r = mix(r, 95, 0.6); g = mix(g, 70, 0.6); b = mix(b, 50, 0.6); }
    if (w.engCover[i]) { r = 175; g = 170; b = 160; }
    const d = w.water[i];
    if (d > 0.008) { const t = Math.min(1, d * 14); r = mix(r, 30, t); g = mix(g, 90, t); b = mix(b, 150, t); }
  }
  for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) put(x * S + dx, z * S + dy, r, g, b);
}
const civ = w.civ;
const sq = (cx, cz, rad, r, g, b) => { for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) put(px(cx) + dx, px(cz) + dy, r, g, b); };
for (let s = 0; s < civ.nS; s++) {
  const k = civ.sKind[s], x = civ.sX[s], z = civ.sZ[s];
  if (k === KIND_DWELLING) { const bias = civ.sBias[s]; const ruin = civ.sDecay[s] > 0.5; sq(x, z, 4, ruin ? 90 : bias < -0.35 ? 60 : bias > 0.35 ? 150 : 230, ruin ? 110 : bias < -0.35 ? 60 : bias > 0.35 ? 90 : 200, ruin ? 80 : bias < -0.35 ? 70 : bias > 0.35 ? 240 : 90); }
  else if (k === KIND_MONOLITH) sq(x, z, 5, 255, 215, 60);
  else if (k === KIND_BRIDGE) sq(x, z, 3, 255, 120, 40);
  else if (k === KIND_STEPS) sq(x, z, 3, 255, 255, 255);
  else if (k === KIND_PAVING) sq(x, z, 3, 220, 220, 120);
  else if (k === KIND_MYTH) sq(x, z, 3, 200, 60, 220);
}
for (let v = 0; v < civ.nV; v++) sq(civ.vX[v], civ.vZ[v], 1, 255, 255, 255);
writeFileSync(out, Buffer.concat([Buffer.from(`P6 ${W} ${W} 255\n`), Buffer.from(img)]));
console.log(`t=${w.stats.time.toFixed(0)}s dwellings ${civ.dwellings} built ${civ.built} bridges ${civ.bridges} myths ${civ.nM} food ${civ.food.toFixed(0)} masons ${civ.masons}`);
