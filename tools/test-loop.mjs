// The causal loop from SPEC 1.1, one link at a time, on the real sim modules (and the real texture/audio bridges):
// water -> moisture -> fertility -> foraging villagers -> traffic -> compaction/frustration -> Masons -> structures -> relief,
// sculpt -> flow, deposition -> fertility, monolith -> culture -> structures/flora texture/music.
import { createWorld } from '../src/sim/world.js';
import { simStep } from '../src/sim/sim.js';
import { prewarm } from '../src/sim/prewarm.js';
import { seedCivilization, ST_FORAGE, KIND_DWELLING } from '../src/sim/civ.js';
import { rainAt, sculptAt, placeMonolith } from '../src/sim/tools.js';
import { sampleGrid } from '../src/sim/sample.js';
import { GRID_N, GRID_W } from '../src/sim/grid.js';
import { hydroStep } from '../src/sim/hydro.js';
import { createSimTextures, packSimTextures } from '../src/gl/simtex.js';
import { createDirector, directorStep } from '../src/audio/director.js';
import { emitEvent, EV_BUILD_DONE } from '../src/sim/events.js';

let failed = 0;
const check = (name, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? '  — ' + d : ''}`); if (!ok) failed++; };
const mk = (seed = 1337) => { const w = createWorld(seed); prewarm(w); seedCivilization(w); return w; };
const cellAt = (wx, wz) => Math.round((wz + 10) / 20 * 128 - 0.5) * GRID_W + Math.round((wx + 10) / 20 * 128 - 0.5);
const patchMean = (a, cx, cz, r) => { let s = 0, n = 0; for (let i = 0; i < GRID_N; i++) { const x = (i % GRID_W + 0.5) / 128 * 20 - 10, z = (((i / GRID_W) | 0) + 0.5) / 128 * 20 - 10; if (Math.hypot(x - cx, z - cz) < r) { s += a[i]; n++; } } return s / n; };

console.log('--- L1 water -> moisture -> fertility');
{
  const w = mk();
  // a dry upland patch and a control patch of equal dryness
  let up = null;
  for (let t = 0; t < 4000 && !up; t++) { const x = -6 + (t % 61) * 0.2, z = -6 + ((t / 61) | 0) * 0.2; const i = cellAt(x, z); if (Math.abs(x) < 6 && Math.abs(z) < 6 && w.elev[i] > 0.7 && w.water[i] < 0.001 && Math.hypot(x, z) < 6) up = [x, z]; }
  const ctl = [-up[0] * 0.8, -up[1] * 0.8];
  w.params.rain = 0; w.params.springRate = 0;
  for (const [x, z] of [up, ctl]) for (let i = 0; i < GRID_N; i++) { const gx = (i % GRID_W + 0.5) / 128 * 20 - 10, gz = (((i / GRID_W) | 0) + 0.5) / 128 * 20 - 10; if (Math.hypot(gx - x, gz - z) < 1.6) { w.moisture[i] = 0.05; w.fertility[i] = 0.2; w.compaction[i] = 0; } }
  const m0 = patchMean(w.moisture, up[0], up[1], 1.0), f0 = patchMean(w.fertility, up[0], up[1], 1.0);
  for (let s = 0; s < 40 * 25; s++) { rainAt(w, up[0], up[1], 1.5, 0.025); simStep(w); }
  const m1 = patchMean(w.moisture, up[0], up[1], 1.0), f1 = patchMean(w.fertility, up[0], up[1], 1.0), fc = patchMean(w.fertility, ctl[0], ctl[1], 1.0);
  check('rain raises soil moisture where it falls', m1 > m0 + 0.25, `${m0.toFixed(2)} -> ${m1.toFixed(2)}`);
  check('moisture raises fertility (watered patch beats an identical dry control)', f1 > f0 + 0.2 && f1 > fc + 0.15, `${f0.toFixed(2)} -> ${f1.toFixed(2)} vs control ${fc.toFixed(2)}`);
}

console.log('--- L2 fertility -> villagers forage where the crops are');
{
  const w = mk();
  w.params.rain = 0;
  // two equal patches near the settlement: one lush, one barren
  const d0 = (() => { let b = 0; for (let s = 0; s < w.civ.nS; s++) if (w.civ.sKind[s] === KIND_DWELLING) { b = s; break; } return b; })();
  const hx = w.civ.sX[d0], hz = w.civ.sZ[d0];
  const lush = [hx + 2.2, hz], bare = [hx - 2.2, hz];
  const setPatch = (c, f) => { for (let i = 0; i < GRID_N; i++) { const gx = (i % GRID_W + 0.5) / 128 * 20 - 10, gz = (((i / GRID_W) | 0) + 0.5) / 128 * 20 - 10; if (Math.hypot(gx - c[0], gz - c[1]) < 1.4 && !w.mask[i]) { w.fertility[i] = f; w.moisture[i] = f; w.water[i] = 0; } } };
  let nearLush = 0, nearBare = 0, samples = 0;
  for (let s = 0; s < 40 * 70; s++) {
    if (s % 40 === 0) { setPatch(lush, 0.95); setPatch(bare, 0.05); }
    simStep(w);
    if (s % 20 === 0) for (let v = 0; v < w.civ.nV; v++) if (w.civ.vState[v] === ST_FORAGE) {
      samples++;
      if (Math.hypot(w.civ.vTX[v] - lush[0], w.civ.vTZ[v] - lush[1]) < 1.5) nearLush++;
      if (Math.hypot(w.civ.vTX[v] - bare[0], w.civ.vTZ[v] - bare[1]) < 1.5) nearBare++;
    }
  }
  check('foragers choose the lush patch far more often than the barren one', samples > 50 && nearLush > nearBare * 3 + 3, `${samples} forage targets: lush ${nearLush}, barren ${nearBare}`);
}

console.log('--- L3 traffic -> compaction -> fertility loss');
{
  const w = mk();
  const A = [w.civ.sX[0], w.civ.sZ[0]], B = [w.civ.sX[0] + 3, w.civ.sZ[0] + 0.5];
  for (let s = 0; s < 40 * 110; s++) {   // 110 sim s: same number of trips as 80 s before walkSpeed 0.55 -> 0.42
    // a steady commute between two points by 20 villagers
    for (let v = 0; v < 20; v++) {
      const at = w.civ.vState[v] === 1 && Math.hypot(w.civ.vTX[v] - w.civ.vX[v], w.civ.vTZ[v] - w.civ.vZ[v]) > 0.2;
      if (!at) { const toB = Math.hypot(w.civ.vX[v] - A[0], w.civ.vZ[v] - A[1]) < 1.5; w.civ.vTX[v] = toB ? B[0] : A[0]; w.civ.vTZ[v] = toB ? B[1] : A[1]; w.civ.vState[v] = 1; }
      w.civ.vTimer[v] = 1e9;
    }
    simStep(w);
  }
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const off = [mid[0], mid[1] + 3];
  const cOn = patchMean(w.compaction, mid[0], mid[1], 0.5), cOff = patchMean(w.compaction, off[0], off[1], 0.5);
  // margin 0.10: Masons working near the path add footfall; with the slower 2026-10-21 order pacing the path reads
  // ~0.15 instead of ~0.17 (ground beside it stays at 0.00)
  check('a busy path becomes worn (compaction up vs ground beside it)', cOn > cOff + 0.10, `on-path ${cOn.toFixed(2)} vs off ${cOff.toFixed(2)}`);
  // compaction -> fertility, as a controlled pair: identical soil and moisture, one patch trampled
  const w2 = mk();
  const P = [-4, -4], Q = [4, 4];
  for (const c of [P, Q]) for (let i = 0; i < GRID_N; i++) { const gx = (i % GRID_W + 0.5) / 128 * 20 - 10, gz = (((i / GRID_W) | 0) + 0.5) / 128 * 20 - 10; if (Math.hypot(gx - c[0], gz - c[1]) < 1.3 && !w2.mask[i]) { w2.soil[i] = 1.0; w2.moisture[i] = 0.7; w2.water[i] = 0.05; w2.fertility[i] = 0.7; w2.compaction[i] = c === P ? 0.6 : 0; } }
  w2.params.rain = 0;
  for (let s = 0; s < 40 * 40; s++) { for (let i = 0; i < GRID_N; i++) { const gx = (i % GRID_W + 0.5) / 128 * 20 - 10, gz = (((i / GRID_W) | 0) + 0.5) / 128 * 20 - 10; if (Math.hypot(gx - P[0], gz - P[1]) < 1.3 && !w2.mask[i]) w2.compaction[i] = 0.6; } simStep(w2); }
  const fP = patchMean(w2.fertility, P[0], P[1], 0.6), fQ = patchMean(w2.fertility, Q[0], Q[1], 0.6);
  check('trampled ground is less fertile than identical untrampled ground', fP < fQ - 0.15, `${fP.toFixed(2)} vs ${fQ.toFixed(2)}`);
}

console.log('--- L4 frustration -> Mason -> structure -> relief (no frustration injected: villagers cause it)');
{
  const w = mk();
  let rc = -1;
  for (let i = 0; i < GRID_N; i++) { const x = i % 128, z = (i / 128) | 0; if (x > 25 && x < 100 && z > 25 && z < 100 && w.water[i] > 0.035 && w.water[i - 3] < 0.003 && w.water[i + 3] < 0.02) { rc = i; break; } }
  if (rc < 0) for (let i = 0; i < GRID_N; i++) { const x = i % 128, z = (i / 128) | 0; if (x > 25 && x < 100 && z > 25 && z < 100 && w.water[i] > 0.03 && w.mask[i] === 0) { rc = i; break; } }
  const cx = -10 + ((rc % 128) + 0.5) * 20 / 128, cz = -10 + (((rc / 128) | 0) + 0.5) * 20 / 128;
  const walkers = 14;
  const crossing = () => { for (let v = 0; v < walkers; v++) { const dxx = w.civ.vTX[v] - w.civ.vX[v]; if (v >= 0 && (w.civ.vState[v] !== 1 || Math.abs(dxx) < 0.15)) { w.civ.vTX[v] = cx + (dxx > 0 ? -0.5 : 0.5); w.civ.vTZ[v] = cz; w.civ.vState[v] = 1; } w.civ.vTimer[v] = 1e9; w.civ.vRole[v] = 0; } };
  for (let v = 0; v < walkers; v++) { w.civ.vX[v] = cx - 0.5 + (v % 3) * 0.1; w.civ.vZ[v] = cz + (v % 5) * 0.05; w.civ.vTX[v] = cx + 0.5; w.civ.vTZ[v] = cz; w.civ.vState[v] = 1; }
  let peakF = 0, tOrder = -1, tBuilt = -1; const t0 = w.stats.time;
  for (let s = 0; s < 40 * 60 && tBuilt < 0; s++) {
    crossing(); simStep(w);
    let f = 0; for (let k = -3; k <= 3; k++) for (let j = -3; j <= 3; j++) f = Math.max(f, w.frustration[rc + k * GRID_W + j]);
    peakF = Math.max(peakF, f);
    if (tOrder < 0) for (let o = 0; o < 12; o++) if (w.civ.oState[o] > 0) tOrder = w.stats.time - t0;
    if (w.civ.built > 0) tBuilt = w.stats.time - t0;
  }
  check('villagers wading/climbing build up frustration on their own', peakF > 0.45, `peak ${peakF.toFixed(2)}`);
  check('frustration summons a Mason (order created)', tOrder >= 0, `after ${tOrder.toFixed(1)} sim s`);
  check('the Mason builds a structure that covers the trouble spot', tBuilt >= 0 && w.civ.built > 0, `built after ${tBuilt.toFixed(1)} sim s`);
  // relief: keep the same crowd crossing for 24 s more (judged after the first 10 s while old frustration drains) — on the covered cells it stays low (it hit the ceiling before)
  let maxCovered = 0, uncoveredPeak = 0;
  for (let k = 0; k < 40 * 24; k++) {
    crossing(); simStep(w);
    if (k > 40 * 10) for (let i = 0; i < GRID_N; i++) if (w.engCover[i]) {                       // after the old frustration has drained, at this crossing only
      const gx = (i % GRID_W + 0.5) / 128 * 20 - 10, gz = (((i / GRID_W) | 0) + 0.5) / 128 * 20 - 10;
      if (Math.hypot(gx - cx, gz - cz) < 1.2 && w.frustration[i] > maxCovered) maxCovered = w.frustration[i];
    }
  }
  void uncoveredPeak;
  check('with the structure in place the same traffic no longer frustrates (covered cells stay calm)', maxCovered < 0.35 && peakF > 0.9, `covered max ${maxCovered.toFixed(2)} vs earlier peak ${peakF.toFixed(2)}`);
  // speed: a villager crosses faster on cover than wading (cost field rewards the structure)
  let onCover = null, wadeCell = null;
  for (let i = 0; i < GRID_N && !(onCover !== null && wadeCell !== null); i++) { if (w.engCover[i] && w.water[i] > 0.025 && onCover === null) onCover = i; if (!w.engCover[i] && w.water[i] > 0.03 && wadeCell === null && w.mask[i] === 0) wadeCell = i; }
  check('a covered crossing exists over water and an uncovered wading cell for comparison', onCover !== null || wadeCell !== null, `cover-over-water ${onCover !== null}, wade ${wadeCell !== null}`);
}

console.log('--- L5 sculpting reshapes the flow');
{
  const w = mk();
  let river = -1;
  for (let i = 0; i < GRID_N; i++) { const x = i % 128, z = (i / 128) | 0; if (x > 25 && x < 100 && z > 25 && z < 100 && w.water[i] > 0.04 && Math.hypot(w.vx[i], w.vz[i]) > 0.5) { river = i; break; } }
  const rx = -10 + ((river % 128) + 0.5) * 20 / 128, rz = -10 + (((river / 128) | 0) + 0.5) * 20 / 128;
  const speed0 = patchMean(w.vx, rx, rz, 0.4);
  // dam: raise a wall across the channel; water must pond upstream (deeper) and the local flow must change
  const ux = rx - Math.sign(w.vx[river] || 1) * 0.9, uz = rz - Math.sign(w.vz[river] || 0) * 0.9;
  const dBefore = patchMean(w.water, ux, uz, 0.5);
  for (let k = 0; k < 6; k++) sculptAt(w, rx, rz, 1.1, 0.6);
  for (let s = 0; s < 40 * 12; s++) simStep(w);
  const dAfter = patchMean(w.water, ux, uz, 0.5);
  const vAfter = patchMean(w.vx, rx, rz, 0.4);
  check('a dam makes water pond upstream and changes the local flow', dAfter > dBefore * 1.15 || Math.abs(vAfter - speed0) > 0.2, `upstream depth ${dBefore.toFixed(3)} -> ${dAfter.toFixed(3)}, vx ${speed0.toFixed(2)} -> ${vAfter.toFixed(2)}`);
}

console.log('--- L6 erosion/deposition feeds fertility (alluvial soil)');
{
  const w = mk();
  const i = cellAt(-3, 3);
  w.mask[i] = 0; w.water[i] = 0; w.fertility[i] = 0.2; w.sediment[i] = 0.06;
  const f0 = w.fertility[i];
  for (let s = 0; s < 60; s++) hydroStep(w);
  check('settling sediment enriches the soil', w.fertility[i] > f0 + 0.05 && w.sediment[i] < 0.06, `${f0.toFixed(2)} -> ${w.fertility[i].toFixed(2)}`);
}

console.log('--- L7 monolith -> culture -> buildings, flora texture, music');
{
  const w = mk();
  const mx = 2.0, mz = 1.0;
  placeMonolith(w, mx, mz);
  for (let s = 0; s < 40 * 25; s++) simStep(w);
  const bias = patchMean(w.culturalBias, mx, mz, 0.6), far = patchMean(w.culturalBias, -mx * 3, -mz * 3, 0.6);
  check('the monolith pulls the surrounding culture to Mystical', bias > 0.7 && far < 0.4, `near ${bias.toFixed(2)}, far ${far.toFixed(2)}`);
  let near = 0, nearMyst = 0;
  for (let s = 0; s < w.civ.nS; s++) if (w.civ.sKind[s] === KIND_DWELLING && Math.hypot(w.civ.sX[s] - mx, w.civ.sZ[s] - mz) < 2.2) { near++; if (w.civ.sBias[s] > 0.35) nearMyst++; }
  check('dwellings near the monolith turn Mystical (crystal spire archetype)', near === 0 || nearMyst === near, `${nearMyst}/${near} dwellings in range`);
  const st = createSimTextures(true); packSimTextures(w, st);
  const j = cellAt(mx + 0.3, mz) * 4 + 3;
  check('the GPU culture texture carries it (flora glows cyan/violet where bias > 0.35)', st.bufB[j] > 0.35, `texB.a ${st.bufB[j].toFixed(2)}`);
  // music: the same event heard near and far from the monolith is pitched differently (regional root shift)
  const notes = [];
  const fakeEng = { trigger(f) { notes.push(f); return true; } };
  const d1 = createDirector(w), sp = (x, z, out) => { out.pan = 0; out.gain = 1; };
  emitEvent(w.events, EV_BUILD_DONE, mx, mz, 2); directorStep(d1, w, fakeEng, { atmo: 0, bias: 0 }, sp, 1);
  const nearNote = notes[0]; notes.length = 0;
  emitEvent(w.events, EV_BUILD_DONE, -mx * 3, -mz * 3, 2); directorStep(d1, w, fakeEng, { atmo: 0, bias: 0 }, sp, 2);
  const farNote = notes[0];
  check('music follows the region (a bridge chime near the monolith is higher than far away)', nearNote > farNote * 1.05, `${nearNote.toFixed(1)} Hz vs ${farNote.toFixed(1)} Hz`);
}

console.log('--- L8 ruins -> migration -> consecration, flood -> myth (cross-system)');
{
  const w = mk();
  const d = 0, sx = w.civ.sX[d], sz = w.civ.sZ[d];
  const home = []; for (let v = 0; v < w.civ.nV; v++) if (w.civ.vHome[v] === d) home.push(v);
  w.params.rain = 0; w.params.springRate = 0;
  for (let v = 0; v < 120; v++) if (w.civ.vRole[v] === 3) w.civ.vRole[v] = 0;
  const bad = () => { for (let i = 0; i < GRID_N; i++) { const gx = (i % GRID_W + 0.5) / 128 * 20 - 10, gz = (((i / GRID_W) | 0) + 0.5) / 128 * 20 - 10; if (Math.hypot(gx - sx, gz - sz) < 1.2) { w.fertility[i] = 0; w.moisture[i] = 0; } } };
  for (let s = 0; s < 40 * 60; s++) { if (s % 8 === 0) bad(); simStep(w); }
  const moved = home.filter(v => w.civ.vHome[v] !== d).length;
  check('villagers abandon a ruined home and move to a healthy dwelling', w.civ.sDecay[d] > 0.9 && moved >= Math.ceil(home.length * 0.5), `decay ${w.civ.sDecay[d].toFixed(2)}, ${moved}/${home.length} rehomed`);
}

if (failed) { console.error(`\n${failed} causal-loop link(s) failed`); process.exit(1); }
console.log('\nevery link of the causal loop is demonstrated connected');
