# Living Mythos — build notes

## Status
- **Current milestone:** M10 done — every milestone in SPEC.md is implemented AND has now been seen rendered: frames are captured headlessly on Mesa llvmpipe (`tools/snap.mjs`, `tools/shoot-tools.mjs`, results in `docs/screens/`) and tuned from them. Not yet checked on the actual phone GPU (performance/feel there is unknown); first thing to do on the phone: open it, try Q/W/E, and report the frame rate (`?debug=1`) and anything that looks off.
- **Headless Chrome (OLD, superseded below):** `~/.cache/ms-playwright/chromium_headless_shell-*` exists; `tools/smoke.mjs`
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

## As built (M6-M10)
- **Civilization** (`src/sim/civ.js`): 120 villagers (SoA), utility AI (rest/haul/forage/migrate/procession/consecrate/greet/gather),
  local 5-heading steering on a cost field, footfall compaction + frustration, Masons (order board of 12) build bridges
  (span across flow, never across lakes), stone steps (stair slabs follow the ground) and lantern paving; max 40 works.
  Dwellings found themselves from food, ruin in barren ground, mystics/monoliths re-consecrate. Culture drifts: engineering ->
  Industrious, tilled land -> Pastoral, monoliths -> Mystical. Myths (max 12): carved glyph stones with a 4-note motif,
  anniversary gatherings every 120 sim s.
- **Pools**: flora 3500, structures 600 (one parametric mesh, parts shown per archetype in the vertex shader), villagers 120,
  particles 1000 (+ a 16-puff raincloud). All have `aInstanceState`. Warm light pools (24 emitters) are faked in the terrain shader.
- **Audio** (`src/audio/`): 16 persistent voices (sine+triangle, optional FM), ping-pong delay, procedural 3.5 s IR, noise bus.
  Tested with a recording fake context and, in headless Chrome, against the real WebAudio (no errors, notes fire).
- **Persistence/quality/photo/debug**: autosave 20 s + on hide (`mythos.save.v1`, ~750 KB); tiers low/mid/high with a governor
  that only steps down; photo mode renders a 2x frame with the UI hidden and downloads a PNG; `?debug=1` adds the dev overlay.
- Sim previews: `node tools/preview-map.mjs` (found: pacing fixes — bridges across lakes, runaway paving — via this view).
- Known gaps / ideas: shadows only from island+skirt (flora/structures don't cast); aurora/moon light is one directional light;
  rivers reach the rim in ~4-5 places (waterfalls exist but are modest); lush valleys cover ~5% (golden grain dominates);
  frame loop allocates ~30 KB/s in the real app (three internals + debug overlay), our own loops are allocation-free in Node tests.
- Headless-test caveats: after ~3 GPU crashes Chrome disables WebGL for the session, so `test-interact` does at most 2 reloads.
- Tried and failed to get a frame out of headless Chrome: default / swiftshader-webgl / --in-process-gpu / hidden canvas / bigger stack / no GPU watchdog. The GPU process segfaults within ~1 s of any real GL work regardless of presentation; in-process mode takes the whole renderer down. Don't spend more time on this here.

## Rendering verification (this supersedes the earlier 'no GPU' notes)
- **What works:** headless Chrome on **Mesa llvmpipe** (software GL) — flags `--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist --disable-frame-rate-limit --disable-gpu-vsync` plus env `LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe`. SwiftShader is what segfaults here; llvmpipe (and lavapipe via `--use-angle=vulkan`) stay alive. Without the vsync flags `requestAnimationFrame` stalls. llvmpipe is slow (shader compile ~5 s, a frame takes seconds), so use `?debug=1&norender=1` for time-based logic tests (the loop and sim run, only the GL draw is skipped).
- `tools/snap.mjs out.png [--query atmo=0.5] [--wait s] [--eval "js"]` renders the app and saves the canvas; `tools/shoot-tools.mjs dir` drives the four tools with the real mouse and saves frames.
- Things only real frames revealed (all fixed): flora far too tall/dense (hid terrain), flat below-horizon sky (the camera looks down, so the dome showed only fog colour — now a cloud sea below the horizon), black night (night light/exposure raised, crops moonlit), monotone terrain (fertility now relaxes toward a moisture x soil-quality target; shader palette mid-fertility = golden grain), water zebra/marble from foam on fast flow (foam only shallow+fast), ring waves/cursor blowing out to cream, lantern diamonds, villagers as tall as houses, rain particles 25x too big, stars invisible (now a spherical grid).
- Tuning knobs worth knowing: `src/gl/atmo.js` presets (exposure per state), `glsl_flora.js` scale (0.58), `TUNING.fertGrow/moistFromRain/moistElevEvap`, `fxbridge.js` ring strengths.
- Remaining visual ideas: aurora/stars only show when orbiting low (default view looks slightly down; a hint appears when choosing Aurora); waterfall spray is subtle; structures don't cast shadows.
