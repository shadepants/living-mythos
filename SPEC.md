# Living Mythos — Iterative Build Spec (v2)

A tactile tilt-shift miniature floating island where water, soil, and a small
civilization co-evolve, and where everything you'd normally read from a HUD is
instead *shown* (shaders, behavior, particles) and *heard* (spatial audio).

This spec is written to be built **incrementally on disk over many sessions**,
not generated in one pass. Every milestone ends with something that runs,
passes its checks, and is committed.

---

## 0. How to work (rules for the builder)

1. **Never one-shot.** Work milestone by milestone (section 6). Do not start
   milestone N+1 until N's acceptance checks pass.
2. **Source of truth is `src/`.** Develop as small ES modules. A build script
   (`tools/build.mjs`, no dependencies) inlines them into one self-contained
   `dist/index.html`. The single file is a build artifact; edit `src/`.
3. **Sim core is pure JS with no DOM/Three imports** (`src/sim/*`). That makes it
   testable in plain Node (`node tools/test-sim.mjs`) with no GPU.
4. **Commit after every green milestone** (`git quick-commit`). Lockfiles are committed.
5. **Verify, don't assert.** Shader/JS errors are caught by running a headless
   browser if available (`tools/smoke.mjs`), otherwise the user opens
   `dist/index.html` and pastes console output back. Say which one was done.
6. **Environment limits (Termux/PRoot, tight RAM):** run `ram-check` before
   browser work; `lms` first if available RAM < 1.5GB; build with `-j4` max;
   never run browser + heavy builds together.
7. **Keep a `NOTES.md`** with: current milestone, known bugs, tuning values
   changed and why. Update it every session so a cold start can resume.
8. **Zero external assets.** Only Three.js (pinned CDN import map in the
   output). No textures, models, audio files, fonts (system font stack).

---

## 1. Concept (the improved version)

The original idea is kept: sculpt land, summon rain, raise monoliths, watch
villagers react. The upgrades make the world feel *authored by consequence*
instead of a bag of features:

### 1.1 The causal loop (the heart of the game)
```
water ──► moisture ──► fertility ──► flora/crops ──► villagers forage
  ▲                                         │
  │                                         ▼
terrain ◄── erosion ◄── flow     traffic ──► compaction ──► frustration
  ▲                                         │
  │                                         ▼
player brushes                    Masons build bridges/steps/paving
                                            │
                                            ▼
                         culturalBias drifts (Industrious / Pastoral / Mystical)
                                            │
                                            ▼
                         architecture + music + glow change; ruins/revival
```
Every system must visibly or audibly feed another. A feature that doesn't
participate in this loop gets cut.

### 1.2 New: Myths (replaces "telemetry")
When something notable happens (first bridge, flood that destroys a village,
monolith revives a ruin, the island's first waterfall), the world records a
**myth event** at that location. Myths are shown *diegetically*:
- a **carved glyph** (procedural sigil shader on a standing stone / cliff face),
- a **recurring motif** in the music (that event's notes become a leitmotif),
- villagers **gather and pause** at the site on the anniversary of the event.
Max 12 myths; oldest fade into weathered, moss-covered glyphs.

### 1.3 New: Time & weather drift
`uAtmoState` is player-selectable **and** can slowly auto-cycle
(Golden Hour → Aurora → Monsoon → …) when "Drift" is on (default on, ~6 min
cycle). Monsoon naturally floods basins; Aurora raises mystical bias slightly;
Golden Hour boosts crop growth. The player's dock selection pins the state.

### 1.4 New: Gentle failure and recovery
Floods, droughts, and landslides happen but are *recoverable and beautiful*:
villagers migrate, ruins moss over, monoliths/rain can heal. Nothing is a
game-over. No fail screens.

### 1.5 New: Touch-first for the target device (Pixel, Termux browser)
- 1-finger drag on empty space = orbit; tap = use tool; hold 400ms = alt action
  (carve / reverse).
- 2-finger pinch = zoom (clamped); two-finger drag = pan (clamped).
- Mouse parity: left = raise, right/Shift = carve, wheel = zoom.
- Pointer-coarse devices get larger dock hit targets (>= 48px).

### 1.6 New: Persistence and photo mode
- Autosave to `localStorage` (typed arrays → base64) every 20s and on
  `visibilitychange`; "Restore on load" falls back to a fresh seed if missing/corrupt.
- Press `P` (or dock long-press) → **photo mode**: hides dock, locks sim, bumps
  render quality, saves a PNG.

### 1.7 No clinical telemetry — with one escape hatch
No FPS counters, charts, or debug HUD in normal play. A hidden dev overlay
appears **only** with `?debug=1` in the URL (frame time, sim ms, mass-conservation
error, entity counts). It must tree-shake out of nothing — it's tiny — but it must
never render without the flag.

---

## 2. Technical contract

### 2.1 Libraries and API
- Three.js **0.186.0** via import map:
  - `three` → `https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js`
  - `three/addons/` → `https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/`
- `OrbitControls` from addons. Timer: `THREE.Timer` from core (the addons copy does not exist in r186)
  Never `THREE.Clock`.
- Loop: `renderer.setAnimationLoop(t => { timer.update(t); const dt = Math.min(timer.getDelta(), 0.05); ... })`.
- **Verify every API against r186 before using it** (CDN source or docs). If an
  API in this spec is wrong for r186, fix the spec in `NOTES.md` and proceed;
  do not silently work around it.
- Renderer: `antialias:false`, `powerPreference:'high-performance'`;
  call `getExtension('OES_texture_float_linear')`; `shadowMap.type = PCFShadowMap`;
  `toneMapping = NoToneMapping`. ACES + sRGB conversion exactly once, in the
  final composite shader.

### 2.2 Capability fallbacks (new — required for a phone)
At boot, detect and degrade gracefully, never crash:
| Missing | Fallback |
|---|---|
| `OES_texture_float_linear` | `NearestFilter` + manual 4-tap bilinear in shaders (`#define MANUAL_BILINEAR`) |
| Half-float render target | 8-bit render target, composite unchanged |
| Depth texture | CoC from tilt plane only (no depth term) |
| WebAudio blocked | Visuals run silent; audio inits on first gesture, retry on each |
| WebGL2 absent | Static message in the page body; no throw |

### 2.3 Quality tiers (new)
`quality ∈ {low, mid, high}` auto-chosen at boot, adapted at runtime from a
rolling frame-time average (no on-screen readout):
| | low | mid | high |
|---|---|---|---|
| pixel ratio cap | 1.0 | 1.5 | 2.0 |
| grid for rendering | 96² mesh over 128² sim | 128² | 128² |
| bokeh taps | 6 | 12 | 12 |
| shadow map | 1024 | 2048 | 2048 |
| flora instances | 1800 | 3500 | 3500 |
| sim substeps / frame | 1 | 2 | 3 |
Downgrade after 2s over budget (>24ms avg); upgrade only at boot/photo mode.

### 2.4 Determinism and RNG (new)
All sim randomness comes from one seeded `mulberry32`. World seed is saved.
Same seed + same inputs ⇒ same island. This is what makes sim tests possible.

---

## 3. Simulation core (`src/sim/`)

### 3.1 Memory layout
Grid `W = H = 128`, `N = 16384`. All state allocated once at boot as flat typed
arrays. **No allocation in the frame loop** (no `new`, `.map`, `.filter`, object
or array literals, closures created per frame, template strings). Enforced by
a Node test that runs 600 frames under `--trace-gc` or an allocation probe and
fails on sustained heap growth.

`Float32Array(N)`: `elev, water, fluxL, fluxR, fluxT, fluxB, vx, vz, sediment,
moisture, fertility, compaction, frustration, culturalBias`.
`Int32Array(N)`: `structureIdx` (-1 = empty). Add `Uint8Array(N) mask` for
island/rim classification (precomputed).

Island mask: radial taper beyond r > 0.88, open cliff rim at r > 0.92
(rim cells are drains).

### 3.2 Hydrology (virtual pipes), per substep `dtSim = 0.025`
1. Flux: `f_n = max(0, f_n*0.992 + dtSim*g*Δh)` for 4 neighbors.
2. Conservation scale: `K = min(1, water / (dtSim*(fL+fR+fT+fB) + 1e-6))`.
3. Continuity: `water += dtSim*(inflow − outflow)`. Rim cells drain; drained
   volume ∝ waterfall spray spawn rate.
4. Velocity from net fluxes; capacity `C = s * min(0.08, water) * kCap`;
   erode/deposit `elev` and `sediment`; deposition raises `fertility`.

**Stability requirements (new):** clamp `g*dtSim` so CFL holds; cap per-cell
water and per-substep Δelev; NaN guard in debug builds. 

**Required Node tests:**
- Mass conservation: with rain off and rim closed (test flag), total water
  drifts < 0.1% over 2000 substeps.
- Rim drain: total water decreases monotonically once rain stops.
- Stability: 20,000 substeps from a random terrain never produce NaN/Inf or
  negative water.
- Determinism: two runs from the same seed are bit-identical.

### 3.3 Ecology
- `moisture` diffuses from `water` and rain, evaporates by atmosphere state.
- `fertility` grows with moisture (and alluvial deposition), decays when dry or
  compacted.
- `compaction` rises under foot traffic, relaxes slowly (faster in Monsoon).
- `frustration` accumulates where slope > 0.035 or water > 0.025 on villager
  paths; decays when a bridge/switchback/paving covers the cell.
- `culturalBias ∈ [-1, 1]` diffuses spatially and drifts via local structures,
  monoliths, and the atmosphere.

### 3.4 Civilization (zero-GC SoA)
Villager arrays: `vX, vZ, vVX, vVZ, vRole, vState, vTargetX, vTargetZ, vCargo,
vEnergy, vPhase`. Roles: Forager, Hauler, Mason, Mystic.
Utility AI: each villager scores actions (forage, haul, build, migrate,
procession, rest, greet) with response curves over fertility, distance,
energy, frustration, culturalBias, time of day. Pick best with small seeded
noise; re-evaluate every 0.5–1.5s (staggered across frames, not all at once).
Pathing: gradient descent on a cost field (slope + water + inverse
compaction), recomputed incrementally in a few rows per frame — no A*, no
allocation.

Structure pool (600): archetype from local `culturalBias`; `decayState` rises
when local fertility < 0.22 (ghost ruin); a Mystic re-consecrates it
(`luminescence → 1`). Mason builds bridge / switchback / paving when
`frustration` crosses threshold; `buildStage 0→1` with dust particles.

### 3.5 Tuning table (new — one place for every pacing constant)
`src/sim/tuning.js` exports a frozen object. Targets:
- visible crop/soil succession within **~25 s** of play,
- Mason dispatch within **~10 s** of localized traffic,
- boot pre-warm of **250** sim ticks then 120 villagers placed.
Never scatter magic numbers; record every change in `NOTES.md`.

---

## 4. Rendering

### 4.1 Data bridge
Two `THREE.DataTexture(Float32Array(N*4), 128, 128, RGBAFormat, FloatType)`:
- `uSimTexA`: R elev, G water, B vx, A vz
- `uSimTexB`: R moisture, G fertility, B compaction, A culturalBias
`Linear` filters, `ClampToEdge`, `needsUpdate = true` after packing (pack
loop is allocation-free). Upload only when the sim advanced.

### 4.2 Meshes
1. **Island**: 128² top grid over [-10,10] + faceted basalt skirt to y = -9.5.
   Vertex displaces by `uSimTexA.r`. Fragment: derivative-based contour
   terraces, ridge bevels, cavity AO, wet shorelines, muddy paths, brush/
   monolith ring waves, myth-glyph projection (1.2).
2. **Water**: 128² grid at `elev + water`, discard `water < 0.008`, Beer-Lambert
   absorption, Fresnel, velocity foam, shoreline ripples.

### 4.3 Instanced pools (each with `aInstanceState` vec4, DynamicDrawUsage)
| Pool | Count | Notes |
|---|---|---|
| Flora | 3500 (tiered) | height by fertility, flatten by compaction, wind, rain gusts, biolum where bias > 0.35 |
| Structures | 600 | 3 cultural archetypes, windmill blades, ruin slump/moss, build stage |
| Villagers | 120 | cloak, head, lantern, cargo; orient/pitch/bob; lanterns lit at night/monsoon |
| Particles | 1000 | subtypes 0 spray/mist, 1 rain, 2 embers/dust, 3 rockfall, 4 sky-lanterns |

Frustum culling off for instanced meshes with a manual bounding sphere.

### 4.4 Post
Scene → `WebGLRenderTarget` (HalfFloat + DepthTexture). Fullscreen composite:
linearize depth, CoC = tilt-plane term combined with view depth (so tall
spires/lanterns at the focal plane stay sharp), golden-angle bokeh (12 taps,
tiered), radial chromatic aberration, vignette, ACES, sRGB. Resize cleanly.

### 4.5 Atmosphere
`uAtmoState` 0 Golden Hour / 0.5 Aurora / 1 Monsoon, smoothly blended into
sun/moon, hemisphere ambient, sky dome (aurora curtains), height fog, and
specular. Point-light *pools* are faked in shader (a small uniform array of
emitters), not real lights — keep dynamic light count at 1.

---

## 5. Interaction and audio

### 5.1 Cursor
Analytical raymarch (32 steps + 4 binary-search refinements) against CPU
bilinear `elev`; **never** `Raycaster` on the grid. Critically damped spring
(ωn = 18, ζ = 1) on the hit point. Ring/aura cursor oriented to terrain normal.

### 5.2 Dock (glassmorphic pill, bottom center)
`backdrop-filter: blur(16px)`, specular border, inline SVG icons, terse labels;
pointer events isolated from the canvas. Tools: Sculpt, Raincloud, Monolith,
Shepherd Breeze. Atmosphere selector: Golden Hour | Aurora | Monsoon (+ Drift
toggle). Keyboard: 1–4 tools, Q/W/E atmosphere, P photo, M mute.

Tool behaviors are as in the original brief: Gaussian sculpt with shockwave
and rockfall; raincloud injecting water/moisture/fertility; up to 8 monoliths
(recycle oldest) pulling culture toward Mystical and reviving ruins; breeze
parting foliage and speeding sky-lanterns.

### 5.3 Audio (no assets, all DSP)
- Lazy `AudioContext` on first `pointerdown`/`keydown`; `resume()`.
- 16 persistent voices, LRU stealing; each = sine + triangle → gain, 5ms linear
  attack, `setTargetAtTime` decay (no clicks).
- Chain: voices → master lowpass → ping-pong delay (cross-feedback, damped) →
  Convolver (procedural 3.5s stereo velvet-noise + octave shimmer IR) → out.
- Pentatonic/Dorian quantizer; mode and root shift with `uAtmoState` and
  regional `culturalBias`. Plucks (sculpt/rain), fifth chord (Mason done),
  bell arpeggio (monolith/lantern). **Myth leitmotifs (1.2)** replay the
  event's notes.
- Environment bus: one noise buffer → wind (bandpass), rapids (bandpass, from
  total flux), rumble (lowpass, from sculpt delta velocity). Cutoff clamp
  [40, 12000] Hz, Q clamp [0.5, 8], updates via `setTargetAtTime(v, now, 0.04)`.
- **Spatial** (new): villager/waterfall/monolith sounds use a `StereoPanner`
  driven by screen-space x, with gain by distance to camera target. Cap
  concurrent one-shots to protect the 16 voices.
- Audio errors never break the render loop (try/catch at the boundary).

---

## 6. Milestones (build in order; each ends green + committed)

**M0 — Skeleton & tooling.** Folder layout, `tools/build.mjs`, import map,
black-screen WebGL2 page with Timer loop, capability detection, `NOTES.md`.
*Check:* `dist/index.html` loads, no console errors, resizes.

**M1 — Sim core in Node.** Arrays, island generation (seeded), hydrology,
erosion, 250-tick pre-warm. *Check:* all section 3.2 Node tests pass; island
prints as ASCII height/water maps that look plausible.

**M2 — Terrain + water render.** DataTexture bridge, island + skirt, water
mesh, orbit camera, basic lighting + shadows. *Check:* rivers, basins, rim
waterfalls visible; sim runs live without NaNs for 5 minutes.

**M3 — Post pass & atmosphere.** Render target, tilt-shift composite, three
atmosphere states with smooth blend, sky dome, fog. *Check:* all three states
look distinct; sharpness behaves at the focal plane.

**M4 — Ecology + flora.** Moisture/fertility/compaction, flora pool, wind and
rain gusts. *Check:* visible succession within ~25 s after sculpting/rain.

**M5 — Cursor & tools.** Raymarch, spring cursor, dock, sculpt + raincloud +
touch gestures. *Check:* tools work on mouse and touch; no `Raycaster` use.

**M6 — Villagers & structures.** SoA AI, pathing, structure archetypes,
ruins/re-consecration, Mason projects, particles pool. *Check:* Mason dispatch
within ~10 s of traffic; zero-GC test passes with entities running.
*Pacing (2026-10-21, Jordan: building too fast):* the first Mason order still comes within seconds, later
orders are spaced by `TUNING.orderGap` (45 sim s) with at most `maxOpenOrders` (2) open; the town grows from 14
to the 40-dwelling cap over ~6-10 real minutes instead of ~1; villagers walk at 0.42 u/s.

**M7 — Monoliths, breeze, myths.** Remaining tools, sky-lanterns, myth events
and glyph rendering. *Check:* revive a ruin with a monolith; a myth glyph
appears after a first bridge.

**M8 — Audio.** Engine, quantizer, env bus, spatial panning, leitmotifs.
*Check:* no clicks, no leaked nodes after 10 minutes, mute works.

**M9 — Persistence, photo mode, drift, polish.** Autosave/restore, photo mode,
atmosphere drift, quality tiers, `?debug=1` overlay. *Check:* reload restores
the island; low tier holds >=30fps on the target phone.

**M10 — Final audit.** Remove dead code, run all tests, build
`dist/index.html`, confirm: no TODO strings, no external assets, no per-frame
allocation, single tone-map, `Clock` never used (grep checks scripted in
`tools/audit.mjs`).

---

## 7. Definition of done
- `dist/index.html` runs offline-except-CDN, single file, on desktop and the
  target phone.
- All Node tests and the audit script pass.
- Every system in the causal loop (1.1) is demonstrably connected.
- `NOTES.md` is current; the repo is committed with lockfiles.
