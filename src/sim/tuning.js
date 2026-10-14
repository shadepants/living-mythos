// Every pacing / physics constant lives here (spec 3.5). Runtime-mutable copies live in world.params.
export const TUNING = Object.freeze({
  dtSim: 0.025,
  seedDefault: 1337,

  // hydrology
  gravity: 9.8,
  fluxDamp: 0.992,
  rain: 0.0002,          // standing-water depth/s over every land cell (soil moisture uses moistFromRain)
  evap: 0.0008,          // depth/s
  springRate: 0.5,       // depth/s at each spring cell
  springCount: 6,
  rimDrainRate: 6.0,     // fraction of water removed per second on rim cells
  velMax: 6.0,           // cells/s clamp on derived flow velocity
  minDepthVel: 1e-4,

  // erosion / deposition
  kCap: 0.35,
  kErode: 0.4,
  kDeposit: 0.6,
  maxDElev: 0.002,       // per substep
  elevFloor: 0.02,       // land never erodes below this
  erodeMinDepth: 0.002,
  depositLip: 0.03,      // deposition may raise a cell at most this far above its highest neighbour
  alluvialGain: 6.0,     // fertility gained per unit of deposited sediment

  // ecology (runs every ecoEvery hydro substeps)
  ecoEvery: 4,
  moistAbsorb: 0.8,       // 1/s toward standing-water wetness
  moistFromWater: 40.0,   // wetness = min(1, water * this)
  moistFromRain: 72.0,    // soil moisture gained per unit rain depth
  moistEvap: 0.03,        // 1/s
  moistElevEvap: 1.4,     // uplands dry faster: evap *= 1 + this * elev
  moistDiffuse: 0.4,
  fertGrow: 0.085,
  fertDecay: 0.04,
  fertCompactDecay: 0.08,
  compactRelax: 0.01,     // 1/s
  biasDiffuse: 0.05,
  biasDecay: 0.002,

  // player tools
  cloudRain: 0.12,        // standing water depth/s at the centre of a raincloud
  monolithRadius: 3.4,    // world units
  monolithPull: 0.45,     // 1/s pull of culturalBias toward +1 at the centre
  monolithPulseEvery: 6.0,
  steepSlope: 0.035,      // per-cell elevation gradient that counts as steep

  // island shape
  rimRadius: 0.92,
  taperStart: 0.5,
  taperEnd: 0.88,
  cliffStart: 0.86,

  // boot
  prewarmTicks: 250,
  prewarmSubsteps: 4,
});
