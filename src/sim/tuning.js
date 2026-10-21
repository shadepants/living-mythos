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
  moistFromRain: 190,    // soil moisture gained per unit rain depth
  moistEvap: 0.03,        // 1/s
  moistElevEvap: 3.5,     // uplands dry faster: evap *= 1 + this * elev
  moistDiffuse: 0.4,
  fertGrow: 0.12,
  fertDecay: 0.05,
  fertCompactDecay: 0.08,
  compactRelax: 0.01,     // 1/s
  // standing vegetation (biomass 0..1: grass < 0.3, crops 0.3-0.65, forest > 0.65); grows toward a ceiling set by
  // fertility, trampling and flooding, so untouched fertile valleys turn to forest over a few real minutes
  biomassGrow: 0.004,     // 1/s approach rate toward the ceiling (~2 real min to 0.65 of it at SIM_SPEED 2)
  biomassDecay: 0.03,     // 1/s when the ceiling drops (trampled, drowned, soil exhausted)
  biomassFertLo: 0.4,     // fertility where the ceiling starts rising
  biomassFertHi: 0.85,    // fertility that supports full forest
  biomassDrown: 0.04,     // standing water depth that drowns vegetation
  biomassSeed: 0.55,      // boot / old-save biomass as a fraction of the ceiling (forest grows in after start)
  forageClear: 0.04,      // biomass removed per forage visit (villagers clear woods around the settlement)
  homeClearRadius: 1.6,   // world units around a healthy dwelling kept open as fields
  homeClearLevel: 0.35,   // biomass at the doorstep (crop level), rising to no limit at the radius
  biasDiffuse: 0.05,
  biasDecay: 0.002,

  // player tools
  cloudRain: 0.12,        // standing water depth/s at the centre of a raincloud
  monolithRadius: 3.4,    // world units
  monolithPull: 0.45,     // 1/s pull of culturalBias toward +1 at the centre
  monolithPulseEvery: 6.0,
  steepSlope: 0.035,      // per-cell elevation gradient that counts as steep

  // civilization
  villagers: 120,
  structureCap: 600,
  dwellingCap: 40,
  startDwellings: 14,
  walkSpeed: 0.42,         // world units/s (was 0.55; slowed 2026-10-21, Jordan: villagers a little too fast)
  slopePenalty: 10,        // speed divisor: 1 + slope * this
  frustrateRate: 0.35,     // frustration/s added per villager standing on a steep or wet uncovered cell
  frustrateDecay: 0.01,    // 1/s everywhere
  coverDecay: 0.2,         // 1/s on cells under a bridge / steps / paving
  orderThreshold: 0.45,    // frustration that summons a Mason
  buildTime: 20.0,         // sim s per Mason work (was 6; pacing pass 2026-10-21)
  maxOpenOrders: 2,        // Mason orders open at once (was 4)
  orderGap: 45,            // sim s between new Mason orders, so works trickle in instead of a burst at boot
  dwellingRise: 0.04,      // build progress/s of a new dwelling (~25 sim s; was 0.08)
  maxMasons: 14,
  maxWorks: 40,            // total bridges / stairs / paving the community will ever build
  ruinFertility: 0.22,
  ruinRate: 0.045,         // decay/s when local fertility is below ruinFertility
  foodPerDwelling: 360,    // was 55: the town filled to the 40-dwelling cap within one real minute

  // island shape
  rimRadius: 0.92,
  taperStart: 0.5,
  taperEnd: 0.88,
  cliffStart: 0.86,

  // boot
  prewarmTicks: 250,
  prewarmSubsteps: 4,
});
