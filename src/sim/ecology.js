import { TUNING } from './tuning.js';
import { GRID_W, GRID_H, GRID_N } from './grid.js';

// Ceiling for standing vegetation: fertile, untrampled, dry ground can carry forest.
export function biomassCap(fert, comp, water) {
  let t = (fert - TUNING.biomassFertLo) / (TUNING.biomassFertHi - TUNING.biomassFertLo);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const k = 1 - comp;
  return t * t * (3 - 2 * t) * k * k * (water > TUNING.biomassDrown ? 0 : 1);
}

// Boot / old-save seeding: start every cell part-way to its ceiling so forests visibly grow in during play.
export function seedBiomass(world) {
  const { fertility, compaction, water, mask, biomass } = world;
  for (let i = 0; i < biomass.length; i++) biomass[i] = mask[i] === 1 ? 0 : TUNING.biomassSeed * biomassCap(fertility[i], compaction[i], water[i]);
}

// Soil moisture, crop/humus fertility, footpath relaxation and cultural drift (spec 3.3). Allocation-free.
export function ecologyStep(world, dt) {
  const p = world.params;
  const { elev, soil, water, moisture, fertility, compaction, culturalBias, mask, ecoTmp, frustration, engCover, biomass } = world;
  const bGrow = TUNING.biomassGrow * p.ecoGrow * dt, bDecay = TUNING.biomassDecay * dt;
  const absorb = Math.min(1, TUNING.moistAbsorb * dt);
  const evap = TUNING.moistEvap * dt * p.evapMul;
  const rainGain = p.rain * dt * TUNING.moistFromRain * TUNING.infiltration;   // the soaked-in share of the rain (x (1 - compaction) per cell)
  const grow = TUNING.fertGrow * p.ecoGrow * dt * 1.0;
  const decay = TUNING.fertDecay * dt;
  const cdecay = TUNING.fertCompactDecay * dt;
  const relax = TUNING.compactRelax * dt;
  const fDecay = TUNING.frustrateDecay * dt, fCover = TUNING.coverDecay * dt;

  for (let i = 0; i < GRID_N; i++) {
    if (mask[i] === 1) { moisture[i] = 0; fertility[i] = 0; compaction[i] = 0; biomass[i] = 0; continue; }
    let wet = water[i] * TUNING.moistFromWater;
    if (wet > 1) wet = 1;
    let m = moisture[i];
    if (wet > m) m += (wet - m) * absorb; else m -= m * evap * (1 + TUNING.moistElevEvap * (elev[i] > 0 ? elev[i] : 0)) / (soil[i] * soil[i]);   // good soil holds water
    m += rainGain * (1 - compaction[i]);
    if (m > 1) m = 1; else if (m < 0) m = 0;
    moisture[i] = m;

    const c = compaction[i];
    let f = fertility[i];
    // fertility relaxes toward a target set by soil moisture, soil quality and trampling
    let sm = (m - 0.12) / 0.73; sm = sm < 0 ? 0 : sm > 1 ? 1 : sm; sm = sm * sm * (3 - 2 * sm);
    let target = sm * (0.35 + 0.8 * soil[i]) * (1 - c);
    if (target > 1) target = 1;
    f += (target - f) * (target > f ? grow : decay + cdecay * c);
    fertility[i] = f > 1 ? 1 : f < 0 ? 0 : f;
    // standing vegetation follows its ceiling slowly up (succession) and faster down (trampling, flooding)
    const cap = biomassCap(fertility[i], c, water[i]);
    const b = biomass[i];
    const nb = b + (cap - b) * (cap > b ? bGrow : bDecay);
    biomass[i] = nb > 1 ? 1 : nb < 0 ? 0 : nb;
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
