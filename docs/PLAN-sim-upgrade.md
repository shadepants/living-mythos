# Simulation upgrade plan (revised, 2026-10-21)

Starting point: Gemini's "Simulation upgrade plans" (PDF, 2026-10-21). Every factual claim in it was checked
against the code at `0244dc1`; this plan keeps what holds, corrects what doesn't, and reorders by value / risk.
Jordan's request added Phase 0 (sim speed). Gemini then reviewed this plan; its four traps were checked against the
code and folded in below (marked **[review]**).

## What the check found

| Gemini claim | Verdict | Evidence |
|---|---|---|
| Sim costs ~1.9 ms/frame on the phone, lots of headroom | **Holds** | phone report 2026-10-21: sim 1.3-2.2 ms/frame; Node: full `simStep` 0.43 ms/substep (hydro 0.35, ecology 0.21-0.24 per call, civ 0.03) |
| Villagers steer with 5 short feelers (0.38 u) and get trapped | **Holds, but small** | `civ.js:322-328`. Measured: 0-8% of villagers walking to an unchanged target made no progress over 2 s (seeds 1337/7/99) |
| "Pools dominate (8% wet, mostly basins)", rivers reach the rim in ~4-5 places | **Out of date** (M1/M2 notes) | measured now: 6-13% of land wet, 83-99% of it moving; 11-22 of 64 rim sectors carry outflow |
| Hydrology is 4-neighbour pipes | **Holds** | `hydro.js:28-34` (fluxL/R/T/B) |
| Flora archetype fixed at boot by `hash2(gx,gz,53)` | **Holds** (line 107, not 80) | `flora.js:107`; flora shaders already read fertility from `uSimTexB` |
| Masons build "from thin air" | **Holds** | haulers only carry food (`civ.js:256-258`); `oProg += dt / buildTime` (`civ.js:465`) |
| `uSimTexC` only uses `.r`, G/B/A free | **Holds** (256 KB, not 192 KB) | `simtex.js:36`; uploaded once per shade sweep (~every 16 frames, `main.js:316`) |
| Eikonal fields converge "every 66 ms" with one directional sweep per frame | **Wrong** | fast sweeping needs several rounds for paths that bend; fields must also update inside `simStep`, not per render frame (see rules) |
| Web Worker via SharedArrayBuffer | **Not available as written** | SAB needs COOP/COEP headers; the app is one `dist/index.html` opened from a simple server or file. Not needed anyway (sim < 0.5 ms/substep) |
| Defer 256² grid and GPU ping-pong sim | **Agree** | phone lost its WebGL context on FBO shadow passes (NOTES) |

Not in Gemini's plan, but it blocks every phase: **adding a sim field breaks saves.** `restoreWorld` rejects the
whole save if a listed field is missing or `SAVE_VERSION` differs (`persist.js:45`), and quota errors are swallowed
silently (`persist.js:75`). The current save is ~747 KB; each new Float32 grid field adds ~87 KB of base64.

## Ground rules for every phase

1. **All sim state changes happen inside `simStep`**, driven by the seeded RNG; nothing per render frame
   (today's particle/RNG bug was exactly this). Determinism test must stay green.
2. Zero-GC: preallocated TypedArrays only; the existing heap tests cover any new step function.
3. **Save migration**: bump `SAVE_VERSION`, accept the previous version and initialise new fields from existing ones
   (e.g. biomass from fertility). Add a persist test that an old-format save still restores, and a size budget
   test (fail above ~2 MB).
4. Keep the audit contract (5 InstancedMesh, pool caps) and update SPEC.md when behaviour changes.
5. Each phase ends with `npm run verify`, preview-map / snap frames, and a phone run (Desktop site **off**).

## Phase 0 — Slow the simulation down (Jordan, first)

Now: `SIM_SPEED = 2.0` sim seconds per real second (`main.js:292`) for everything: water, walking, growth,
building, myth clocks. Phone soak: 240 s real = 503 s sim.

- Make speed a tunable: `TUNING.simSpeed` plus a `?speed=` URL switch for trying values on the phone.
- Default to **1.0** (half the current speed) as a first cut, then judge on the phone.
- Then split "motion" from "pacing" if needed: water and walking may look right at 1.0 while growth / building / myths
  still feel rushed. Those are separate constants (`buildTime` 6 s, `ANNIVERSARY` 120 s, ecology rates, order
  clocks) and can be stretched without making water crawl.
- Check: time-based checks in `test-interact` (e.g. Monsoon rainfall after 5.5 s, pool >= 8 structures) may need
  longer waits; sim tests call `simStep` directly and are unaffected. Fewer substeps per frame also lowers CPU cost.
- **[review] Frames with no sim step.** The sim runs fixed 0.025 s steps; at speed 1.0 and 60 fps the pattern is
  0, 1, 1 steps per frame, so a third of frames advance nothing (`main.js:312-315`). Two consequences:
  - Brush strokes (`sculptAt` / `rainAt` run in `ctl.update`, every frame) only reach the GPU on frames with a step,
    because `packSimTextures` is gated on `n > 0`. Fix: a `world.dirty` flag set by the tools; pack when
    `n > 0 || world.dirty`.
  - Villagers are drawn straight from sim positions (`villagers.js:56`), so they would move in 40 Hz steps on a 60 Hz
    screen. Fix: keep the previous position per villager and interpolate by `simAcc / dt` when filling the instance
    buffer (render-side only; sim stays deterministic). The phone already runs at 60-82 fps, so this judder exists
    above ~80 fps even at today's 2.0.
- **[review] SPEC feel targets.** SPEC.md asks for visible crop/soil succession within ~25 s of play (line 212) and
  Mason dispatch within ~10 s of traffic (line 324), both tuned at 2.0. Slowing down is the point, so Phase 0
  rewrites these targets in SPEC to whatever Jordan settles on, rather than speeding those rates back up.
- **Decide with Jordan on the phone:** which feels too fast — the motion, the pace of change, or both.
  Later phases set their own timing targets in sim seconds against the speed chosen here.

## Phase 1 — Living vegetation (Gemini Phase 3, first half)

Most visible payoff, lowest risk; pure ecology plus shaders.
- New `biomass` grid field (0..1): grows toward a fertility- and moisture-driven ceiling; forage, compaction and
  flooding knock it back. Bands: grass < 0.3, crops 0.3-0.65, trees > 0.65.
- Pack it into `uSimTexC.b` (free channel); the flora shader shows trees where biomass is high instead of the
  boot-time hash (keep the hash as per-tuft jitter so the forest edge isn't a hard line).
- **[review]** `uSimTexC` is only uploaded when a shade sweep completes (~every 16 frames, `main.js:316`). Fine for
  slow growth; for instant changes (a villager clears a tree, a brush stroke) also write biomass in
  `packSimTextures` and flag `texC` for upload on frames that pack.
- Foragers prefer and reduce biomass; this is the hook for Phase 2's timber.
- Timing target: an untouched fertile valley turns into forest over a few real minutes at the Phase 0 speed.
- Tests: growth/clearing rates, determinism, zero-GC, save migration; snap frames before/after.

## Phase 2 — Building materials (Gemini Phase 3, second half), trimmed

- Haulers fetch **stone** from steep exposed cells and **timber** from biomass > 0.65 and deliver to open Mason
  orders. Supplied orders build faster; unsupplied orders still progress slowly (no deadlock if the island has no
  forest or quarry).
- Quarrying lowers `elev` a little, clamped and rate-limited. Logging lowers biomass (ties to Phase 1).
- **[review] Quarry sites:** dry upland only: `water === 0` on the cell and its 4 neighbours, steep
  (`slope > TUNING.steepSlope`), well above the water table. `depositLip` is only 0.03, so quarrying a pond's rim
  could drain it. Check with `preview-map` that no basin or river changes course.
- **[review] Mass bookkeeping:** add `world.stats.quarried` and include it in the `?debug=1` rock-drift readout
  (`main.js:276`), or the overlay will show a fake erosion leak.
- Extend `test-loop.mjs` with the new links: forest -> timber -> bridge; slope -> stone -> steps.

## Phase 3 — Smarter walking (Gemini Phase 1), smaller than proposed

The measured problem is 0-8% stuck villagers, so start small and measure.
- One or two shared distance fields, cost = slope + unbridged water, relaxed with a few fast-sweeping passes on a
  fixed substep cadence inside `simStep`.
- **[review] Use a field only when the villager's target is one of its sources.** A field seeded at *every*
  healthy dwelling fits `ST_HAUL` (goes to the nearest one) but not `ST_REST` (own home, `civ.js:188`) or
  `ST_MIGRATE` (one specific dwelling, `civ.js:209`): following the shared gradient would lead them to the wrong
  door and `arrive()` would never fire. Those states keep the local steering (or rest at any healthy dwelling and
  update `vHome` on arrival, a design change to decide then).
- Keep the 5-feeler steering for local avoidance; blend in the field gradient.
- Goal: stuck rate < 2% and more crossings over built bridges (add a counter). Budget < 0.2 ms/substep.
  Add more fields (food, monument) only if those trips show up as stuck.

## Phase 4 — Water extras (Gemini Phase 2), mostly cut

- **Drop the diagonal pipes:** the motivation (basin-dominated water) is out of date, and changing the pipe model
  means retuning hydro, erosion, waterfalls and fertility.
- **Keep, cheap:** compacted paths absorb less rain (infiltration scaled by `1 - compaction`), so trampled roads
  turn into runoff gullies in Monsoon; muddy water tint from `sediment` in `uSimTexC.g`.
- **[review]** The water material doesn't bind `uSimTexC` yet (`terrain.js:91`; the island shader does), and sediment
  moves every substep, so pack it with `packSimTextures` on every stepped frame, not on the shade-sweep cadence.
- **Experiment behind a TUNING flag:** lateral bank erosion; keep only if preview-map shows better channels.
- **Defer groundwater:** moisture already diffuses (`ecology.js:50`) and springs exist.

## Deferred

Web Worker (sim < 0.5 ms/substep; SAB unavailable here), 256² grid, GPU simulation passes.

## Order

Phase 0 -> 1 -> 2 -> 3 -> 4. Phases 1 and 2 share the biomass field; Phase 3 benefits from Phase 2's extra trips.
