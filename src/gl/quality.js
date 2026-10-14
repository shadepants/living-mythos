// Quality tiers (spec 2.3). Auto-picked at boot, stepped down when frames run long; never stepped up mid-play.
export const TIER_NAMES = ['low', 'mid', 'high'];
export const QUALITY = {
  low: { pr: 1.0, taps: 6, shadow: 1024, flora: 1800, substeps: 1 },
  mid: { pr: 1.5, taps: 12, shadow: 2048, flora: 3500, substeps: 2 },
  high: { pr: 2.0, taps: 12, shadow: 2048, flora: 3500, substeps: 3 },
};

// env: {coarse, mem, cores, dpr, override}. Returns a tier index into TIER_NAMES.
export function pickInitialTier(env) {
  if (env.override && TIER_NAMES.indexOf(env.override) >= 0) return TIER_NAMES.indexOf(env.override);
  if (env.coarse) return env.mem && env.mem <= 4 ? 0 : 1;          // phones/tablets: mid, or low on small devices
  if (env.cores && env.cores <= 2) return 0;
  return 2;
}

export function createGovernor(tier) {
  return { tier, ema: 0.016, slow: 0, budget: 0.024, window: 2.0, warm: 4.0 };   // warm: ignore start-up hitches (shader compile, first uploads)
}

// Feed every frame's dt. Returns the new tier index when it drops one, else -1.
export function governorSample(g, dt) {
  if (g.warm > 0) { g.warm -= dt; return -1; }
  if (dt > 0.1) dt = 0.1;                        // one hitch is not a trend
  g.ema += (dt - g.ema) * 0.1;
  if (g.ema > g.budget) g.slow += dt; else g.slow = Math.max(0, g.slow - dt * 2);
  if (g.slow > g.window && g.tier > 0) {
    g.tier--; g.slow = 0; g.ema = 0.016;                              // give the new tier a fair start
    return g.tier;
  }
  return -1;
}
