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

## Phase 0 — Slower pace of change (DONE 2026-10-21)

Jordan's call: the **pace of change** is too fast (buildings go up too fast, villagers walk a little too fast);
water and weather speed are fine. So the global `SIM_SPEED` stays at 2.0, which also sidesteps the
frames-with-no-sim-step problem the review found (it remains for screens above ~80 fps; villager interpolation
stays on the list if judder shows up on the phone).

Measured before (Node, 3 seeds, real minutes at 2.0): dwellings went 14 -> 35-40 (the cap) **in the first minute**
and 10-13 Mason works were built in that minute; then almost nothing changed for 9 minutes.

Changes (all in `TUNING` / `civ.js`):
- `foodPerDwelling` 55 -> 360, `dwellingRise` 0.08 -> 0.04 per sim s (a dwelling takes ~25 sim s to go up)
- `buildTime` 6 -> 20 sim s, `maxOpenOrders` 4 -> 2, new `orderGap` 45 sim s between Mason orders,
  `frustrateRate` 0.7 -> 0.35
- `walkSpeed` 0.55 -> 0.42

Result (same measurement): dwellings 14 -> ~17-19 at 1 min, ~28-34 at 4 min, cap at ~6-10 min; works ~2-3 in the
first minute, then ~1-2 per minute up to ~13-16 by 12 min. Tests: two timing windows widened (Mason build window
20 -> 60 sim s; path-wear commute 80 -> 110 sim s, margin 0.15 -> 0.10 since fewer Masons work near the test path).
Still to do: judge on the phone; nudge the numbers if it now feels too slow.

## Phase 1 — Living vegetation (DONE 2026-10-21)

- `world.biomass` (0..1, saved): each ecology tick it moves toward a ceiling = smoothstep(fertility 0.4..0.85)
  x (1 - compaction)^2, zero under standing water > 0.04. Up slowly (`biomassGrow` 0.004/s), down faster (0.03/s).
  Foragers remove 0.04 per visit; healthy dwellings keep a 1.6 u radius open at crop level (`homeClearRadius/Level`),
  since settlements sit on the most fertile ground and forest otherwise grew right up to the doors.
- Seeded at 55% of its ceiling after prewarm and when loading a v1 save (`SAVE_VERSION` 2, `ADDED_IN` map in
  persist.js; v1 saves still load).
- GPU: packed into `uSimTexC.b` on the shade-sweep upload (~every 16 frames; per-frame packing would re-upload
  256 KB each frame for a field that changes over minutes). The flora shader shows trees on
  mix(4%, 70%) of tufts as biomass goes 0.6 -> 0.95 (crops stay open fields); the boot-time hash only picks which.
- Measured (Node, seeds 1337 / 7, real minutes at SIM_SPEED 2): forest (biomass > 0.65) 0% at boot, ~1% at 2 min,
  6-12% at 4 min, 5-13% at 8 min; crops 20-36%; forest within 1.4 u of homes 5-10% (was 43-61% before the
  clearing rule). First tuning (fertility 0.3..0.75, no clearing) gave 27-47% forest and buried the villages.
- Tests: growth / trampling / drowning / range / seeding / home clearing (fails with clearing off) / determinism /
  v1 migration / round-trip / corrupt biomass rejected. Frames: `docs/screens/succession-boot.png`,
  `succession-4min.png` (via the new debug hook `__mythos.advance(simSeconds)`).
- Phone (2026-10-21): an old v1 save loaded and migrated on the device (save 747 -> 832 KB), 0 errors, fps avg ~60
  (min 52 after load), sim 2.4 ms/frame. Jordan: "looks decent".

## Phase 1b — Asset sizing (DONE 2026-10-21)

Before (world units): villager 0.44 tall, cottage walls 0.34 / ridge 0.54, grass ~0.25-0.45, trees ~0.46 (max 0.73),
monolith ~1.2. Villagers stood taller than cottage walls, grass reached their shoulders, trees barely topped a person.

Anchor kept: dwellings, monoliths, island. Sizes now live in `src/gl/scale.js` (`SIZE`):
- villagers 0.68 scale (~0.27 tall, ~half a cottage), bob 0.6x, walk-cycle stride 1.6x (shorter legs step more often)
- grass blades: height 0.3, footprint 0.5 (were 0.58 / 0.58)
- trees: height 1.1, footprint 1.15, and a fuller crown on a shorter trunk (`flora.js`: trunk 0.52 -> 0.42,
  crown radius 0.2 -> 0.27, crown height 0.17 -> 0.25), so trees stand ~2-3 cottages tall instead of lollipops
- walking 0.42 -> 0.30 u/s (~1.1 body heights/s; at 0.42 the smaller villagers would cover ~1.6/s and look rushed);
  `foodPerDwelling` 360 -> 260 keeps the Phase 0 town-growth pace (measured within ~1 dwelling over 12 min)
- tests: myth bridge window 40 -> 90 sim s, anniversary gathering 135 -> 150 sim s (slower walk)
- frames: `docs/screens/sizing-village-before.png`, `sizing-village.png`, `sizing-island.png`; the close-up camera
  script is `tools/snap-village.js` (`node tools/snap.mjs out.png --eval "$(cat tools/snap-village.js)"`).
  The planned `?lineup=1` view wasn't needed.
- Not changed yet (check on the phone): particle sizes next to the smaller villagers, cursor rings.

## Phase 2 — Building materials (DONE 2026-10-21)

- Bridges need **timber**, steps and paving need **stone**; a work wants `matPerOrder` (3) loads. It builds at full
  speed while delivered material lasts and at `unsuppliedRate` (0.35) without, so it never deadlocks.
- Haulers take material runs (`ST_FETCH` -> `ST_SUPPLY`, utility 1.05) to the nearest open work within 6 u that is short
  of material; the run survives re-decisions (like a Mason's job) and is abandoned after 60 sim s. Orders closing
  release their haulers. Runtime-only state (`vSupply`, `vCargoKind`, `oMat`, `oSupp`); save format unchanged.
- Sources within 3 u of the work: timber from biomass > 0.6 (felling removes 0.45 at the cell, 0.2 around it; it
  regrows); stone only where `quarryOk`: steep, no water within 2 cells, not covered, > 0.8 u from a home (the
  review's levee warning). Quarrying lowers elevation (0.006 at the cell, 0.002 around), tracked in
  `stats.quarried`; the `?debug=1` rock-drift readout adds it back.
- Cargo shows as a tinted load: basket brown (food), dark wood (timber), grey (stone) (`docs/screens/hauler-stone.png`).
- Measured (3 seeds, 12 real min): 38-50 stone loads, 0-4 timber (few bridges; little mature forest by rivers early),
  ~0.8-1.1 elevation units quarried in total; town pace unchanged (12-16 works by 12 min).
- Tests (`test-sim` 5e0, civStep-only so no water moves): stone gets quarried and delivered; no lowered cell touches
  water; `stats.quarried` matches the removed rock exactly; timber gets felled; a supplied bridge finishes before an
  unsupplied one and both finish. Test windows widened for slower unsupplied builds; the first-bridge myth test now
  opens its order directly (it relied on the random order scan hitting one frustrated cell).
- Tuning to revisit: deliveries usually arrive ~40-50 s into a build (walk + source distance), so supplied works rarely
  run at full speed for long. Options: let haulers pre-stock orders as soon as they open, or shorter source radius.

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

## Phase 5 — Asset upgrade and realism (Jordan, 2026-10-21; to be planned in detail)

Jordan wants a more realistic simulation and better-looking assets. Phase 1b fixed proportions only; the models are
still very low-poly kit shapes (6-blade tufts, octahedron crowns, box cottages, cone villagers).
- Assets: richer tree models (2-3 species by biome/biomass, layered crowns), crop rows instead of identical tufts on
  farmland, cottages with doors/windows/varied roofs, villagers with readable silhouettes per role. Budget: the
  phone holds ~60 fps today; keep vertex counts per pool in check and measure on the device.
- Realism in the sim: candidates to weigh against Phases 2-4: seasons or day-length effects on growth, livestock /
  field plots tied to dwellings, tree age and felling for timber (Phase 2), erosion on cleared slopes.
- Start with a short options list and pick with Jordan before building.

## Open observations and questions (for later)

- 2026-10-21 phone run of a fresh world after Phase 2 (~2 min): 0 errors, fps avg ~57 (min 42 after load), worst frame
  50 ms, sim 1.5-2.0 ms/frame, structures 15 -> 26, sim ran ~1.7x real time (substep cap). Snapshot shows the new
  sizes reading right on the device.
- Sculpt cursor ring looks big next to the smaller villagers. It is the tool's real effect radius (1.5 u), not a
  sizing bug. Question for Jordan: shrink the brush for the new scale (less terrain changed per stroke)?
- Phase 2 tuning: material deliveries usually land ~40-50 s into a build, so supplied works barely speed up.
  Question: let haulers stock a work as soon as its order opens (before the Mason arrives)?
- Timber is rare early (0-4 loads in 12 min): little mature forest near rivers in the first minutes. Watch whether
  that feels right once forests have grown in.
- Not yet seen on the phone: haulers with grey/brown loads (needs a longer watch).
- Particle sizes (rockfall, dust) next to the smaller villagers: not checked yet (Phase 1b leftover).
- Taps in Chrome "Desktop site" mode read as drags (MOVE_PX vs zoomed layout); fix if it comes up again.

## Deferred

Web Worker (sim < 0.5 ms/substep; SAB unavailable here), 256² grid, GPU simulation passes.

## Order

Phase 0 -> 1 -> 1b -> 2 -> 3 -> 4, with Phase 5 to be scheduled with Jordan. Phases 1 and 2 share the biomass field; 1b sets sizes before Phase 2 adds
quarries and timber; Phase 3 benefits from Phase 2's extra trips.
