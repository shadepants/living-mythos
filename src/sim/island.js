import { TUNING } from './tuning.js';
import { Rng } from './rng.js';
import { fbm, valueNoise, smoothstep } from './noise.js';

const GW = 128, GH = 128;

// Seeded island: basalt+clay height, rim drains, springs near high ground, initial fertility.
export function generateIsland(world) {
  const { elev, mask, fertility, culturalBias } = world;
  const seed = world.seed;
  const rng = new Rng(seed ^ 0x9e3779b9);
  let rimCount = 0;

  for (let z = 0; z < GH; z++) {
    for (let x = 0; x < GW; x++) {
      const i = z * GW + x;
      const nx = ((x + 0.5) / GW) * 2 - 1;
      const nz = ((z + 0.5) / GH) * 2 - 1;
      const r = Math.sqrt(nx * nx + nz * nz);
      const rw = r + 0.10 * (fbm(nx * 2.2 + 7, nz * 2.2 + 3, seed + 1, 3) - 0.5);
      const shape = 1 - smoothstep(TUNING.taperStart, TUNING.taperEnd, rw);
      const hills = fbm(nx * 1.6, nz * 1.6, seed, 4);
      const rn = 1 - Math.abs(2 * valueNoise(nx * 2.4 + 11, nz * 2.4 + 5, seed + 2) - 1);
      const base = 0.25 + 1.1 * (0.65 * hills + 0.35 * rn * rn);
      const land = base * (0.35 + 0.65 * shape);
      const cliff = 1 - smoothstep(TUNING.cliffStart, TUNING.rimRadius, rw);
      const rimElev = -0.6 - 0.8 * Math.max(0, r - TUNING.rimRadius);
      elev[i] = rimElev + (land - rimElev) * cliff;
      if (r > TUNING.rimRadius) { mask[i] = 1; rimCount++; } else mask[i] = 0;

      const low = Math.min(1, Math.max(0, 0.75 - land * 0.35 + (fbm(nx * 5, nz * 5, seed + 3, 3) - 0.5) * 0.5));
      fertility[i] = mask[i] ? 0 : low;
      culturalBias[i] = (valueNoise(nx * 2 + 31, nz * 2 + 17, seed + 4) - 0.5) * 0.2;
    }
  }

  world.rimCells = new Int32Array(rimCount);
  let k = 0;
  for (let i = 0; i < GW * GH; i++) if (mask[i]) world.rimCells[k++] = i;

  // Springs: highest cells in the inner island, kept apart from each other.
  const want = world.springs.length;
  let placed = 0;
  const minDist2 = 20 * 20;
  for (let attempt = 0; attempt < 4000 && placed < want; attempt++) {
    const x = Math.floor(rng.range(24, GW - 24)), z = Math.floor(rng.range(24, GH - 24));
    const nx = ((x + 0.5) / GW) * 2 - 1, nz = ((z + 0.5) / GH) * 2 - 1;
    const r = Math.sqrt(nx * nx + nz * nz);
    if (r < 0.12 || r > 0.62) continue;
    const i = z * GW + x;
    // Hill-climb to the local maximum.
    let bx = x, bz = z;
    for (let s = 0; s < 40; s++) {
      let best = elev[bz * GW + bx], mx = bx, mz = bz;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const px = bx + dx, pz = bz + dz;
        if (px < 1 || pz < 1 || px >= GW - 1 || pz >= GH - 1) continue;
        const e = elev[pz * GW + px];
        if (e > best) { best = e; mx = px; mz = pz; }
      }
      if (mx === bx && mz === bz) break;
      bx = mx; bz = mz;
    }
    let ok = true;
    for (let j = 0; j < placed; j++) {
      const sx = world.springs[j] % GW, sz = (world.springs[j] / GW) | 0;
      if ((sx - bx) * (sx - bx) + (sz - bz) * (sz - bz) < minDist2) { ok = false; break; }
    }
    if (!ok) continue;
    world.springs[placed++] = bz * GW + bx;
    void i;
  }
  for (let j = placed; j < want; j++) world.springs[j] = world.springs[0];
}
