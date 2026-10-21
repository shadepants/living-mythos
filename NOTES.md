# Living Mythos — build notes

## Status
- **Current milestone:** M10 done and VERIFIED ON THE DEVICE: it runs on the Pixel's own GPU (PowerVR D-Series DXT-48-1536, ANGLE/GLES 3.2) at ~59 fps average with no WebGL context loss over a 150 s soak and no errors; frames from that GPU are in `docs/screens/phone-portrait.png`. Real finger touch was verified on the device too (see below).
- **How it is verified:** on the phone's own Chrome (real GPU, touch; see "phone" notes below) and in headless Chrome on Mesa **llvmpipe** (software GL) for mouse/keyboard/tests. SwiftShader's GPU process segfaults ~1 s after the first draw in this PRoot, so don't use it; the working flags are in the llvmpipe note below. `tools/smoke.mjs` drives headless Chrome via puppeteer-core; `?debug=1` logs GL caps and `programs compiled: N`.
- `tools/test-geo.mjs` checks grid winding and skirt geometry in Node (three is a devDependency).
- Open `dist/index.html` on-device (or `python3 -m http.server` in `dist/`); add `?debug=1` to log detected GL caps to the console.

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

## On-device verification (the phone is the dev machine)
- Termux `am`/`termux-open-url` can open the phone's own Chrome/Brave: `termux-open-url http://localhost:8765/?report=NAME&debug=1&fresh=1`, with `node tools/phone-server.mjs 8765 /tmp/phone` collecting `?report` posts (GPU name, fps, frame/worst ms, tier, programs, context-lost counters, errors) in `/tmp/phone/reports.jsonl` plus a canvas snapshot `/tmp/phone/NAME.png` at t=10 s. `am start --user 0 -n com.brave.browser/com.google.android.apps.chrome.Main -a android.intent.action.VIEW -d URL` also works for Brave. The page only runs frames while the screen is on and the tab is foreground, so reports stop when the phone locks. (Never `pkill -f`/`pgrep -f` a pattern that appears in your own command line — it kills the shell, exit 144.)
- **Bug found only on the phone: WebGL context lost ~2-9 s after load, white screen forever.** Bisected on the device with URL switches: `noshadow=1` held 28+ s; every run with shadow maps lost the context (PCF, Basic, 512/1024/2048 maps, with/without the custom displaced depth material, with/without post, flora on/off — all lost). So the GPU shadow-map pass kills this PowerVR/Chrome combination. Fix: no GPU shadow maps by default; the sun's shadows come from a CPU heightfield march (`src/sim/shade.js`, 8 rows/frame, uploaded as `uSimTexC`) applied to the direct light only in the island/flora/structure/villager shaders. `?realshadow=1` brings the GPU shadow pass back for experiments. `renderer.shadowMap.enabled/type` are still set as the spec says.
- Diagnostic switches (all harmless): `?pr=1.0` pixel ratio, `?flora=N`, `?nopost=1`, `?noshadow=1`, `?shadowtype=basic`, `?shadowsize=N`, `?nocustomdepth=1`, `?realshadow=1`, `?q=low|mid|high`, `?norender=1` (with debug).
- Portrait: the island was cropped on a tall phone; vertical FOV widens from 32 to 58 deg as the aspect drops below 1.2 and the camera starts 20% further back; max distance 58.
- Quality governor now ignores the first 4 s (shader-compile hitches had demoted the phone to `low` at t=4 s).

## Real touch on the phone (verified 2026-10-14)
Instrumented controller (`ctl.st.stats`, included in `?report` posts). Two live sessions with a person touching the Pixel:
- Session 1 (70 s): 190 touch-downs, 50 taps recognised as tool taps, 1 long-press carve, 50 drags, 27 multi-touch events; camera distance went 35 -> 27.9 -> 58 (pinch zoom out clamped at maxDistance 58); sculpt, cloud and breeze tools used from the dock; fps avg 64, min 52; 0 errors, no context loss.
- Session 2 (50 s, scripted routine): Monolith tool selected from the dock and 3 monoliths placed by tap; 2 long-press carves ('hold-carve'); 8 one-finger drags (orbit) and 4 pinch gestures; camera distance 9.2 (minDistance reached) to 57.8 (max); fps avg 64.4, min 54.4; tier stayed mid; 0 errors; context never lost.
Not covered: palm rejection / very long sessions / other devices.

## Scope decisions
- Desktop browsers are explicitly not a priority (user, 2026-10-14). The app was exercised on: the phone's Chrome (real GPU, touch), headless desktop-build Chrome on llvmpipe (mouse/keyboard/tests). SPEC section 7's 'desktop' clause is therefore waived for now.
- `tools/test-loop.mjs` (part of `npm test`) demonstrates each link of SPEC 1.1's causal loop on the real modules: water->moisture->fertility, fertility->foraging, traffic->compaction->fertility loss, villager-caused frustration->Mason->structure->relief (calm under the same traffic: 0.00 vs 1.00 peak), sculpt->flow, deposition->fertility, monolith->culture->dwellings/GPU texture/music pitch, ruin->rehoming. The weather->sim link (Monsoon x rain, evaporation, growth) and sim->GPU structure pool are checked in `tools/test-interact.mjs` against the running app.

## Long session on the phone (2026-10-14)
- Continuous run with the screen on and the tab in front: **240 s real time = 503 sim seconds, no context loss, 0 errors, fps avg ~62 (min 47), tier stayed mid, JS heap flat at 13-14 MB, sim cost flat (~1.9 ms/frame), autosave 747 KB**. Then the tab reloaded itself (new load with t=2 s, fresh=1) with healthy numbers right before — most likely Android discarding/reloading the tab or a manual refresh; nothing in the app logged an error. Not tested: 10+ minute runs, backgrounding/resuming (the audio suspends and the loop pauses on hide by design).
- Browser tabs only run frames while visible and the screen is on — unattended phone soaks are impossible; ask for the screen to be kept on.

## Polish pass (after on-device verification)
- **Audio, measured offline** (`npm run audio`, `tools/test-audio-render.mjs`: real engine in an OfflineAudioContext): the first render clipped at +1.0 dBFS in dense passages. Fixed with a master DynamicsCompressor limiter and per-note loudness / (1 + 0.14 x busy voices). Now: worst case (25 notes at once) peaks at -5.5 dBFS, bed ~-37 dB rms and L/R balanced, music ~14 dB above the bed, reverb tail decays >8 dB, no NaN/pops. Still not heard by a human.
- **Waterfalls**: 64 cascade ribbons (`src/gl/waterfall.js`) hug the basalt skirt, from the land edge over the lip to ~half-depth, width/opacity from the real per-sector rim outflow (strongest ~0.006/substep; ~20 of 64 directions carry flow); mist spawns at the cliff foot. Plain Mesh, not an InstancedMesh (audit still expects exactly 5).
- **Shadows**: terrain shadows from the heightfield march plus soft ellipse shadows of dwellings/monoliths/myth stones stamped into the same shade field (`stampObjectShadows`).
- **Lushness**: soil quality now shapes moisture retention (evaporation / soil^2) and the fertility target (sm x (0.35 + 0.8 soil)); palette thresholds moved so mid fertility reads green. After a minute: fertility spread ~evenly 0..1, ~25% fully lush, ~13% scrub; screenshots `docs/screens/island-topdown.png`, `waterfall.png`.
- Phone re-check of this build: 58 s, 59 fps avg (min 41), mid tier, 11 programs, 0 errors, no context loss.

## External code review (Gemini 3.1 + Gemini 4, 2026-10-21)
Source bundle uploaded as one text file (Gemini's GitHub "Import code" read the repo as a binary blob). Every finding was checked against the code; fixed ones have regression tests that fail on the old code.
- **Fixed:** recycled monolith / myth-stone slots kept their old instance matrix (obelisk drawn at the old spot) — `civ.sEpoch` bump + rewrite in `structures.js`; holding sculpt and dragging off the island kept digging at the frozen cursor — paused while a held press is off-island (tap bursts unaffected); particles drew from `world.rng` once per render frame, making the sim frame-rate dependent (SPEC 2.4) — they use `Math.random` now; procession targets could land past the cliff (monolith r<=8.4 + 0.75) — clamped to r 8.3; the particle pool uploaded and drew all 1000 slots every frame — live particles are packed into the front slots and only that range is drawn/uploaded (one zero-size instance when idle so the program still compiles at boot).
- **Rejected after checking:** stuck touch counter / OrbitControls pointer leak (OrbitControls captures the pointer and removes it regardless of `enabled`); `scanForOrders` off-grid reads (the grid border is always rim); stale `rimOut` (`drainRim` is only turned off by tests); audio filter-automation "leak" (updates are throttled to 20 Hz and use the SPEC's own `setTargetAtTime`); stolen-voice ramp clicks (the offline render forces stealing and measures no pops); full-grid water mesh and the shared structure super-mesh (design choices, phone holds ~59 fps).
- **Open, low:** the 8-notes-per-frame cap (SPEC) can drop a myth leitmotif in a big burst of events; the structure state/kind attributes are re-uploaded every frame (~19 KB).
- `test-interact`'s touch-drag check now uses `ctl.st.sculptClock` instead of elevation (a fresh pit silts up on its own and made it flaky).
- Phone re-check of the fixed build (2026-10-21): 186 s, fps 60-82, worst frame 33 ms, sim 1.3-2.2 ms, 12 programs, 0 errors, no context loss, heap 13 MB. Chrome was in "Desktop site" mode (980 px layout on a 444 px screen), which shrinks `MOVE_PX` to ~4.5 real px so every tap read as a drag (0 taps / 118 touches) — the monolith and off-island fixes were covered by `test-interact` only. If taps misbehave again, scale `MOVE_PX` by `innerWidth / screen.width`.

## Pacing pass (2026-10-21)
Jordan: buildings went up too fast and villagers walked a little too fast (water/weather speed fine), so `SIM_SPEED`
stays 2.0 and only civ pacing changed: food per dwelling 55 -> 360, dwelling rise 0.08 -> 0.04/s, Mason build
6 -> 20 s, at most 2 open orders with 45 sim s between them, frustration 0.7 -> 0.35/s, walk 0.55 -> 0.42 u/s.
Before: the town hit the 40-dwelling cap and ~12 works within the first real minute. After: cap at ~6-10 minutes,
works trickle in at ~1-2 per minute. Details and the measurement script approach are in `docs/PLAN-sim-upgrade.md`.

## Living vegetation (Phase 1, 2026-10-21)
`world.biomass` drives tree density: forests grow in fertile, untrampled, dry ground over a few real minutes; flooding,
trampling and foraging clear them; homes keep their fields open. Packed into `uSimTexC.b`. Save version 2 (v1 saves
migrate). Debug hook `window.__mythos.advance(simSeconds)` fast-forwards the real sim for "minutes later" frames on
llvmpipe. Details and measurements in `docs/PLAN-sim-upgrade.md` Phase 1.

## Asset sizing (Phase 1b, 2026-10-21)
Sizes are in `src/gl/scale.js`. Villagers ~0.27 tall (were 0.44, taller than cottage walls), grass much shorter, trees
taller with fuller crowns. Walking slowed to 0.30 u/s to match the smaller bodies, food per dwelling 260 to keep the
town's growth pace. Close-up frames: `node tools/snap.mjs out.png --eval "$(cat tools/snap-village.js)"`.

## Building materials (Phase 2, 2026-10-21)
Haulers fetch timber (from mature forest) and stone (from steep dry upland, never near water or homes) for Mason works;
supplied works build at full speed, unsupplied ones crawl. Quarrying is tracked in `stats.quarried`. Details and
measurements in `docs/PLAN-sim-upgrade.md` Phase 2.

