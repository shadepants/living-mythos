import { GRID_W, GRID_H, WORLD_SIZE } from './grid.js';

// World <-> grid mapping. Cell (x,z) centre is at world -10 + (x+0.5)*CELL; the GPU textures use the same texel centres.
export function worldToGridX(wx) { return (wx + WORLD_SIZE * 0.5) / WORLD_SIZE * GRID_W - 0.5; }
export function worldToGridZ(wz) { return (wz + WORLD_SIZE * 0.5) / WORLD_SIZE * GRID_H - 0.5; }

// Bilinear sample of any grid channel at a world position (allocation-free).
export function sampleGrid(arr, wx, wz) {
  let gx = worldToGridX(wx), gz = worldToGridZ(wz);
  if (gx < 0) gx = 0; else if (gx > GRID_W - 1.001) gx = GRID_W - 1.001;
  if (gz < 0) gz = 0; else if (gz > GRID_H - 1.001) gz = GRID_H - 1.001;
  const x0 = gx | 0, z0 = gz | 0, fx = gx - x0, fz = gz - z0;
  const i = z0 * GRID_W + x0;
  const a = arr[i], b = arr[i + 1], c = arr[i + GRID_W], d = arr[i + GRID_W + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

// CPU twin of the vertex shader's terrainHeight(): elevation with the perimeter collapsed onto the cliff ring.
export function visualHeight(elev, wx, wz) {
  const r = Math.sqrt(wx * wx + wz * wz) / 10;
  let px = wx, pz = wz;
  if (r > 0.92) { const k = 0.92 / r; px = wx * k; pz = wz * k; }
  const e = sampleGrid(elev, px, pz);
  let t = (r - 0.895) / (0.92 - 0.895);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  t = t * t * (3 - 2 * t);
  return e + (-0.6 - e) * t;
}

// 32-step march through the island's bounding volume, then 4 binary-search refinements (spec 6.1).
// Writes the hit to out.{x,y,z}; returns false on a miss. No allocation.
export function raymarchHeightfield(elev, ox, oy, oz, dx, dy, dz, out) {
  const YMIN = -1.0, YMAX = 3.2, HALF = 10;
  let t0 = 0, t1 = 1e9;
  // slab test against [-HALF,HALF] x [YMIN,YMAX] x [-HALF,HALF]
  const o0 = ox, o1 = oy, o2 = oz, d0 = dx, d1 = dy, d2 = dz;
  for (let a = 0; a < 3; a++) {
    const o = a === 0 ? o0 : a === 1 ? o1 : o2;
    const d = a === 0 ? d0 : a === 1 ? d1 : d2;
    const lo = a === 1 ? YMIN : -HALF, hi = a === 1 ? YMAX : HALF;
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
    let ta = (lo - o) / d, tb = (hi - o) / d;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  const STEPS = 32;
  const dt = (t1 - t0) / STEPS;
  let prevT = t0;
  let tPrev = t0;
  let hit = false, tHi = 0, tLo = 0;
  for (let s = 0; s <= STEPS; s++) {
    const t = t0 + dt * s;
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    if (y <= visualHeight(elev, x, z)) { hit = true; tHi = t; tLo = s === 0 ? t0 : prevT; break; }
    prevT = t;
    tPrev = t;
  }
  if (!hit) return false;
  for (let k = 0; k < 4; k++) {
    const tm = 0.5 * (tLo + tHi);
    const x = ox + dx * tm, y = oy + dy * tm, z = oz + dz * tm;
    if (y <= visualHeight(elev, x, z)) tHi = tm; else tLo = tm;
  }
  const t = 0.5 * (tLo + tHi);
  out.x = ox + dx * t; out.y = oy + dy * t; out.z = oz + dz * t;
  void tPrev;
  return true;
}
