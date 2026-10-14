# Living Mythos — build notes

## Status
- **Current milestone:** M5 done (cursor, 4 tools, dock, touch). Next: M6 villagers/structures/particles. All GL work is compile-verified only; input/tool logic is verified by `npm run interact` (real mouse/touch in headless Chrome). NOTHING has been seen rendered.
- **Headless Chrome (important):** `~/.cache/ms-playwright/chromium_headless_shell-*` exists; `tools/smoke.mjs`
  drives it via puppeteer-core. SwiftShader's GPU process **segfaults ~1s after the first draw in this PRoot**
  (every flag combo tried), so there are **no screenshots/pixel checks**. But shader compile/link errors and JS
  exceptions DO surface first (verified by injecting a deliberate GLSL error), and `?debug=1` logs
  `programs compiled: N` (expect 6 from M2). So: smoke = compile + boot check; the user must eyeball visuals.
- `tools/test-geo.mjs` checks grid winding and skirt geometry in Node (three is a devDependency).
- (old) Verification at M0: build + static audit + `node --check` of the inlined bundle pass.
  **Not yet run in a browser** (no Chromium in this PRoot). Open `dist/index.html` on-device
  (or `python3 -m http.server` in `dist/`) and expect a rotating normal-shaded octahedron on a dark
  purple background. Add `?debug=1` to log detected GL caps to the console.

## Commands
- `npm test` runs `node --expose-gc tools/test-sim.mjs` (add `-- --map` for an ASCII island map).
- `npm run build` → `dist/index.html`; `npm run check` → build + audit; `npm test` → sim tests (M1+).

## Bundler rules (tools/build.mjs)
Local imports `./x.js`; `export const|function|class` only (no default); top-level names unique
across all modules (flat scope after inlining; build fails on duplicates); no import cycles.

## Spec corrections found while building
- `three/addons/misc/Timer.js` does **not** exist in r186 (CDN returns an error); importing it would
  break the whole module. `THREE.Timer` is exported from core `three`. Use `new THREE.Timer()`.
- `PCFSoftShadowMap` still exists in r186 core (spec said removed); we use `PCFShadowMap` anyway.

## M1 results (seed 1337, this device)
- 8 sim tests pass: determinism, mass conservation (0.0000% drift), rim drain, 20k-substep stability,
  zero heap growth over 1500 substeps, prewarm sanity. Whole suite ~20 s; prewarm (250 ticks x 4
  substeps = 1000 substeps) ~0.7 s.
- Files: `src/sim/{tuning,rng,noise,world,island,hydro,prewarm}.js`. Sim modules are not in the browser
  bundle yet (main.js imports them from M2).
- Not in M1 by design: moisture/fertility succession, compaction, frustration, culture drift (M4+);
  `fertility` currently only gets a seeded start value plus alluvial deposition boosts.
- `world.params` is the runtime-mutable copy of tuning (tests flip `drainRim`, `rain`, etc.).
- `world.rimOut[i]` = water drained over the cliff by cell i in the last substep (for waterfall spray);
  `world.stats.flux` = total pipe outflow (for the rapids audio); `world.stats.rimDrained` accumulates.
- Directions: flux T = toward z-1, B = z+1, L = x-1, R = x+1. Velocities are in cells/s.

## Tuning changes
- island.js: terrain amplitude/frequency reduced after the first version had median slope 0.047/cell
  (68% of cells above the 0.035 steep threshold). Now median ~0.021, ~17-22% steep (seeds 1337/7/99).
- Revisit after seeing it rendered (M2): pools dominate over river lines (8% wet, mostly basins);
  may need stronger springs or lower sediment deposition to get longer channels.

## Known bugs
(none known; untested in browser)

## M3-M5 notes
- Sim: ecology (moisture/fertility/compaction/culture) every 4 hydro substeps via `simStep`; tools in `src/sim/tools.js`;
  event ring in `src/sim/events.js` (renderer rings, audio and particles each keep their own cursor).
- Hydrology fixes found by long-run tests: sediment transport is now conservative donor-cell (the semi-Lagrangian version
  created mass and inflated land ~30%); deposition can't raise a cell more than `depositLip` above its highest neighbour
  (a spike grew to elev 6); rain/evap/spring rebalanced (rain 0.0002, evap 0.0008, spring 0.5) so ponds reach equilibrium
  (~9-10% wet) instead of flooding. Soil moisture uses `moistFromRain`, standing water uses `rain`.
- Raymarch: 32 steps + 4 binary refinements, matches a dense reference except on cliff-lip grazing rays (~1%); the
  controller ignores hits with r > 8.7 so the cliff band is never acted on.
- Headless: `npm run interact` drives dock, mouse (left/right/Shift), touch tap/long-press/drag and checks sim effects.
  The page exposes `window.__mythos` only with `?debug=1`.
- Controls: mouse left-hold on island = tool, right/Shift = alt (carve); drag off-island orbits; touch tap = pulse, long-press
  400ms = alt hold, drag = orbit, pinch = zoom. Keys: 1-4 tools, Q/W/E atmosphere, D drift.
- Weather feeds the sim: monsoon rain x9, golden hour grows crops fastest (set each frame in main.js).
