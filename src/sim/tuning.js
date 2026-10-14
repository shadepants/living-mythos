// Every pacing / physics constant lives here (spec 3.5). Runtime-mutable copies live in world.params.
export const TUNING = Object.freeze({
  dtSim: 0.025,
  seedDefault: 1337,

  // hydrology
  gravity: 9.8,
  fluxDamp: 0.992,
  rain: 0.0006,          // depth/s over every land cell
  evap: 0.0004,          // depth/s
  springRate: 0.35,      // depth/s at each spring cell
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
  alluvialGain: 6.0,     // fertility gained per unit of deposited sediment

  // island shape
  rimRadius: 0.92,
  taperStart: 0.5,
  taperEnd: 0.88,
  cliffStart: 0.86,

  // boot
  prewarmTicks: 250,
  prewarmSubsteps: 4,
});
