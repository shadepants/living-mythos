import { TUNING } from './tuning.js';
import { GRID_W, GRID_H, GRID_N } from './grid.js';

// Soil moisture, crop/humus fertility, footpath relaxation and cultural drift (spec 3.3). Allocation-free.
export function ecologyStep(world, dt) {
  const p = world.params;
  const { elev, soil, water, moisture, fertility, compaction, culturalBias, mask, ecoTmp, frustration, engCover } = world;
  const absorb = Math.min(1, TUNING.moistAbsorb * dt);
  const evap = TUNING.moistEvap * dt * p.evapMul;
  const rainGain = p.rain * dt * TUNING.moistFromRain;
  const grow = TUNING.fertGrow * p.ecoGrow * dt * 1.0;
  const decay = TUNING.fertDecay * dt;
  const cdecay = TUNING.fertCompactDecay * dt;
  const relax = TUNING.compactRelax * dt;
  const fDecay = TUNING.frustrateDecay * dt, fCover = TUNING.coverDecay * dt;

  for (let i = 0; i < GRID_N; i++) {
    if (mask[i] === 1) { moisture[i] = 0; fertility[i] = 0; compaction[i] = 0; continue; }
    let wet = water[i] * TUNING.moistFromWater;
    if (wet > 1) wet = 1;
    let m = moisture[i];
    if (wet > m) m += (wet - m) * absorb; else m -= m * evap * (1 + TUNING.moistElevEvap * (elev[i] > 0 ? elev[i] : 0));
    m += rainGain;
    if (m > 1) m = 1; else if (m < 0) m = 0;
    moisture[i] = m;

    const c = compaction[i];
    let f = fertility[i];
    // fertility relaxes toward a target set by soil moisture, soil quality and trampling
    let sm = (m - 0.12) / 0.73; sm = sm < 0 ? 0 : sm > 1 ? 1 : sm; sm = sm * sm * (3 - 2 * sm);
    let target = sm * (0.5 + 0.5 * soil[i]) * (1 - c);
    if (target > 1) target = 1;
    f += (target - f) * (target > f ? grow : decay + cdecay * c);
    fertility[i] = f > 1 ? 1 : f < 0 ? 0 : f;
    const cr = engCover[i] === 4 ? relax * 25 : relax;
    compaction[i] = c > cr ? c - cr : 0;
    const fr = frustration[i];
    if (fr > 0) { const d = engCover[i] !== 0 ? fCover : fDecay; frustration[i] = fr > d ? fr - d : 0; }
  }

  // diffusion of moisture and cultural bias (4-neighbour average into scratch, then blend)
  const kd = TUNING.moistDiffuse, kb = TUNING.biasDiffuse * dt, kdec = TUNING.biasDecay * dt;
  for (let z = 0; z < GRID_H; z++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = z * GRID_W + x;
      const l = x > 0 ? i - 1 : i, r = x < GRID_W - 1 ? i + 1 : i, u = z > 0 ? i - GRID_W : i, d = z < GRID_H - 1 ? i + GRID_W : i;
      ecoTmp[i] = (moisture[l] + moisture[r] + moisture[u] + moisture[d]) * 0.25;
    }
  }
  for (let i = 0; i < GRID_N; i++) if (mask[i] === 0) moisture[i] += (ecoTmp[i] - moisture[i]) * kd;

  for (let z = 0; z < GRID_H; z++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = z * GRID_W + x;
      const l = x > 0 ? i - 1 : i, r = x < GRID_W - 1 ? i + 1 : i, u = z > 0 ? i - GRID_W : i, d = z < GRID_H - 1 ? i + GRID_W : i;
      ecoTmp[i] = (culturalBias[l] + culturalBias[r] + culturalBias[u] + culturalBias[d]) * 0.25;
    }
  }
  for (let i = 0; i < GRID_N; i++) {
    if (mask[i] === 1) { culturalBias[i] = 0; continue; }
    let b = culturalBias[i];
    b += (ecoTmp[i] - b) * kb - b * kdec;
    culturalBias[i] = b > 1 ? 1 : b < -1 ? -1 : b;
  }
}
