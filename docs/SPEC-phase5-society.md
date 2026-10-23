---
Title: Living Mythos Phase 5: Society from one family
Type: Tech Spec
Version: 1.0
Status: Approved
Owner: Jordan
Created: 2026-10-22
Last Updated: 2026-10-23
Approvers: Jordan
---

# Living Mythos Phase 5: Society from one family

## 1. Summary

The island stops starting with a finished town of 14 homes and 120 villagers. It starts with **one primitive family**.
The family grows, splits into camps, and advances mainly through **discoveries** that spread slowly from camp to camp.
Existing features (Mason works, timber and stone, mystics, myths, cottage archetypes) become things a camp unlocks.
The decisions are fixed in `docs/PLAN-sim-upgrade.md` (Phase 5 table). This document turns them into rules, starting
numbers and acceptance tests. **Every number marked (tune) is a starting value that 5e will adjust; the acceptance
targets in section 8 are the contract.**

Sub-phases: 5a population and camps · 5b know-how · 5c gating · 5d models by stage · 5e long-run tuning.

## 2. Time base

- The app runs the sim at `SIM_SPEED = 2` sim s per real s (`src/main.js`), and the substep cap lets it fall to about
  1.7x on the phone.
- All rules and tests use **sim seconds**:

| Target (from Jordan) | Real time | Sim time |
|---|---|---|
| First discovery | ≤ 5 min | ≤ 600 s |
| Town scale (≥ 100 people, ≥ 30 homes) | ~2 h | ~14,400 s (±25%) |

- Rules that run once per second run in the existing 1 Hz `secondTick`. Per-substep work is limited to the villager
  loop over living villagers.

## 3. Population and camps (5a)

### 3.1 Data (all preallocated typed arrays; no allocation in any step)

| Field | Type / size | Meaning |
|---|---|---|
| `vAlive` | Uint8[120] | 1 = slot in use. Dead or unborn slots are skipped by every loop and hidden by the renderer |
| `vAge` | Float32[120] | sim s since birth |
| `vLife` | Float32[120] | age at which this villager dies of old age |
| `vCamp` | Int32[120] | camp index, -1 while wandering |
| `cActive` | Uint8[8] | camp in use (`MAX_CAMPS = 8`) |
| `cX, cZ` | Float32[8] | camp centre (the first home) |
| `cFood` | Float32[8] | camp food store; replaces the global `civ.food` |
| `cPop`, `cHomes` | Int32[8] | recounted every second |
| `cBirthT`, `cSplitT`, `cStarveT` | Float32[8] | clocks for the rules below |
| `cFounded` | Float32[8] | sim time the camp was founded |
| `nAlive`, `emptyT` | numbers | living total; seconds the island has been empty |

Each dwelling records its camp in a new `sCamp` Int32[600].

### 3.2 Start

1. Choose the site: the best of 200 samples by fertility within 5 units of the centre that pass `siteOk`
   (dry, slope ≤ 0.026, fertility ≥ 0.5).
2. Found camp 0 there with one finished dwelling (stage 0, hide shelter) and `cFood = 40` (tune).
3. Spawn **5 villagers**: 2 adults (age 600-900 s) and 3 children (age 0-300 s), all within 0.6 of the dwelling.
4. All other 115 slots start with `vAlive = 0`.
5. No Mason orders, no mystics, no processions (masons and mystics stay off until 5c, as decided).

### 3.3 Food

- Foraging and hauling keep today's behaviour, but a haul delivers food to **the hauler's camp** (`cFood`), not
  `civ.food`.
- Upkeep: each living villager eats `eatRate = 0.04` food/s (tune) from their camp.
- Children (age < `adultAge = 300` s) forage at half weight and never become Masons.

### 3.4 Births

Once per second, per active camp, a birth happens when **all** of these hold:
- `cFood ≥ birthFood (40) + 4 × cPop` (tune);
- `cPop < campCap` (3.6);
- `cPop < (cHomes + 1) × householdSize`: room for the child, at most one household beyond the camp's homes
  (keeps test 8.5a-4 true when crowding blocks new homes);
- `nAlive < 120`, so a free slot exists;
- at least `birthGap = 45` s since the camp's last birth.

The child spawns at the camp centre, joins the dwelling with the fewest members, and gets
`vLife = lifeBase (2400) + rng × lifeSpread (1200)` (tune). `cFood -= birthFood`.

### 3.5 Deaths

- **Old age:** `vAge ≥ vLife`. The slot is freed (`vAlive = 0`), any job or supply run is released, and the hauler
  bookkeeping is cleared.
- **Starvation:** while `cFood ≤ 0`, `cStarveT` counts up. At `starveAfter = 60` s the oldest member of the camp dies
  and the clock resets. Food above 0 resets the clock.
- **Floods:** the existing flood myth already damages homes. A dwelling reaching decay 1 makes its members homeless
  (they re-home in the camp, or the camp shrinks through starvation). No direct flood deaths in 5a.

### 3.6 Households and homes

- Living around a home tramples it open: before Farming, biomass within `campClearRadius = 1.0` of a healthy
  dwelling is pushed toward grass (`campClearLevel = 0.15`), rising to no limit at the radius. Once Farming is known,
  today's crop clearing (`homeClearRadius 1.6`, level 0.35) takes over. Without this the forest hides the camp.
- A camp wants `ceil(cPop / householdSize)` dwellings, with `householdSize = 3`. At 120 people that gives 40 homes,
  which is today's `dwellingCap`.
- When a camp has fewer dwellings than it wants and `cFood ≥ homeFood (60)` (tune): a new dwelling is placed
  0.9-2.0 units from the camp centre (`siteOk`, min spacing 1.3). It rises at the existing `dwellingRise`, and
  `cFood -= homeFood`.
- **Camp capacity:** `campCap = campCapBase (12) × capMult`. `capMult` is 1 in 5a; know-how raises it in 5b/5c
  (Farming ×1.5, Storage ×1.25). With 8 camps that gives 96 people in 5a and 120+ after Farming.

### 3.7 Camp split (the carrier of ideas)

Once per second, per camp, a split happens when **all** of these hold:
- `cPop ≥ campCap`;
- the camp has ≥ 2 dwellings;
- fewer than 8 camps are active;
- at least `splitGap = 120` s since the camp's last split.

1. The leaving household is the dwelling with the most members that includes at least one adult.
2. The new site is the best of 40 samples at 3.0-6.0 units from the camp centre that pass `siteOk`, are ≥ 2.5 from
   every camp centre, and lie inside radius 7.6. Best = highest fertility. No valid site → no split (retry after
   `splitGap`).
3. The new camp is created at that site with `cFood = old cFood × leavers / cPop`, taken from the old camp.
4. The leavers walk there (`ST_MIGRATE`). When the first one arrives, a stage-0 dwelling appears and they re-home to it.
5. (5b) The new camp copies the old camp's adoption values × 0.8 (ideas travel with the family, slightly diluted).

### 3.8 Abandonment and the floor rule

- A camp with `cPop = 0` becomes inactive. Its dwellings decay at `ruinRate` until ruined. Ruins keep their existing
  look and can still be revived later (5c, Ritual).
- **Floor:** when `nAlive = 0` for `emptyWait = 60` s, a wandering family of 4 (2 adults, 2 children) spawns at the
  island rim (radius 7.4) and walks inward to the best `siteOk` site, where it founds a camp as in 3.2. The island
  can never stay empty.

### 3.9 Roles in 5a

- Only Forager and Hauler.
- Role is chosen at each `decide` from need: camp food below `2 × birthFood` → Forager, otherwise alternate so that
  about a third are Haulers.
- `ROLE_MASON` and `ROLE_MYSTIC` are not assigned until their ideas unlock (5c). `scanForOrders`, processions,
  consecration and anniversary gatherings are skipped while their gate is closed.

### 3.10 Rendering in 5a

- `villagers.js` writes a zero-scale matrix for slots with `vAlive = 0`. The instance count stays 120, so the audit
  contract (5 InstancedMesh, pool caps) is unchanged.
- Children render at 0.7 scale.
- Brought forward from section 6 so a primitive camp never shows later-era things (Jordan, 2026-10-22):
  `homeStage(civ, s)` (society.js) drives the home model. Society homes are stage 0 hide shelters (no plinth, no
  hearth glow before Fire); the `?town=1` start stays at stage 2 with its culture archetypes. Villagers wear hides
  below stage 2, and lanterns appear only once Ritual is open. Stages 1 and 3 (wattle hut, stone house) and role tools
  still come in 5d, once 5b gives camps know-how to compute a stage from.

## 4. Know-how (5b)

### 4.1 Ideas

Ten ideas, each with an adoption value 0..1 per camp (`kAdopt` Float32[8 × 10]). An idea is **known** in a camp at
adoption ≥ 0.5 and **lost** below 0.05.

| # | Idea | Needs (prereq known) | Need signal (0..1, per camp) | Character bias ×2 when |
|---|---|---|---|---|
| 0 | Fire | none | 1 (always) | none |
| 1 | Shelter | Fire | mean `moisture` within 2 units (player rain raises it), or 1 for 300 s after a flood hits the camp | none |
| 2 | Baskets | none | forage trips in the last 600 s / 40 | Pastoral |
| 3 | Farming | Baskets | seconds foraged on fertility > 0.6 ground / 600 | Pastoral |
| 4 | Woodworking | Fire | share of cells within 3 units with biomass > 0.65 | none |
| 5 | Stonework | Fire | share of steep cells within 3 units | Industrious |
| 6 | Bridges | Woodworking | mean `frustration` on wet cells within 4 units | Industrious |
| 7 | Paths (steps, paving) | Stonework | mean `frustration` on steep or compacted cells within 4 units | Industrious |
| 8 | Ritual | Fire | 0.3 + 0.7 × (monolith or myth stone within 4 units) | Mystical |
| 9 | Storage | Baskets | seconds with `cFood` above `campCap × 10` / 300 | Pastoral |

Character comes from `culturalBias` at the camp centre: Industrious < -0.33 ≤ Pastoral ≤ 0.33 < Mystical.

### 4.2 Discovery

- Once per second, for each camp and each idea with its prereqs known and adoption < 0.05, discovery happens with
  probability `p = base_k × need × (1 + cPop / 20) × character × monolith`.
  - `monolith = 2` when the camp centre is within `monolithRadius` (3.4) of a player monolith, else 1.
  - `base_k` (tune): Fire `1/300` (so the expected first discovery with 5 people ≈ 240 s), the others `1/1200`.
- On discovery: adoption = 0.1 and an `EV_DISCOVERY` event fires (sound cue and a toast in debug).
- A myth stone is carved when **either** of these holds (myth pool of 12, oldest recycled as today):
  - it is the island's first discovery of that idea;
  - the camp is within monolith range.

### 4.3 Adoption inside a camp

Logistic growth, `da/dt = q × a × (1 − a)` with `q = 1/90` per s (tune). It takes about 400 s to go from 0.1 to 0.9,
so an idea visibly takes hold over a few real minutes rather than at once.

### 4.4 Spread by contact

- **Contact** means a villager of camp A is within 1.5 units of camp B's centre: foraging, hauling or migrating
  past.
- Each such villager-second adds `spread = 0.004 × (aA − aB)` to B's adoption of each idea where `aA > aB`
  (tune).
- Splits carry ideas (3.7 step 5).
- The result is a wave outward from the first camp to know an idea, at roughly walking range per few minutes.

### 4.5 Fading

- Each idea has a per-camp "last used" clock, set by the action the idea enables:
  - Fire, Shelter: rest;
  - Baskets, Farming: forage;
  - Woodworking: timber haul;
  - Stonework, Paths: stone haul or a stone work;
  - Bridges: a bridge work;
  - Ritual: procession or consecration;
  - Storage: food above the spoil threshold.
- Unused for `fadeAfter = 900` s → adoption decays at `1/1800` per s. Below 0.05 the idea is lost.
- Prereq loss does not cascade instantly: a lost prereq only blocks new discovery.

## 5. Gating map (5c)

| Idea known in the camp | Unlocks |
|---|---|
| Fire | Rest restores +50% energy; myth "the first fire" |
| Shelter | Homes build at stage 1 (wattle hut); `householdSize` 3 → 4 |
| Baskets | Forage cargo per visit 0.35 → 0.5 |
| Farming | Fields around homes (today's `homeClear` biomass rule); `capMult × 1.5`; forage on cleared land ×1.5 food |
| Woodworking | Timber fetch runs; homes at stage 2 (timber cottage) |
| Bridges | `KIND_BRIDGE` Mason orders; Mason role becomes available |
| Stonework | Quarrying; homes at stage 3 (stone house) |
| Paths | `KIND_STEPS` and `KIND_PAVING` Mason orders |
| Ritual | Mystic role (≤ 10% of the camp), processions, consecration and revive, monolith, lantern and anniversary myths |
| Storage | No spoilage. Without Storage, `cFood` above `campCap × 10` spoils at 0.5%/s; `capMult × 1.25` |

Mason orders are only opened at cells within `supplyRange` of a camp that knows the matching idea, and only that
camp's villagers become its Masons.

## 6. Models by stage (5d)

- **Homes:** stage = highest known of Shelter (1), Woodworking (2), Stonework (3), else 0.
  - Stage 0 is a hide shelter, 1 a wattle hut, 2 a timber cottage, 3 a stone house.
  - The culture archetypes (Pastoral windmill cottage, Industrious quarry house, Mystical shrine) apply from stage 2.
  - Existing homes upgrade when rebuilt or revived; a slow per-home "rebuild" at most 1 home per camp per 60 s.
- **Villagers:** hides (camp stage 0-1), cloaks (2+), plus role tools (basket, axe, chisel, lantern) when the role's
  idea is known.
- **Carried over from the earlier asset plan:** richer trees (2-3 species), crop rows on farmed land, readable
  silhouettes.
- **Budget:** villager mesh ≤ 2× today's vertex count; phone fps average ≥ 50.

### 6.1 5d-2 design (agreed with Jordan 2026-10-22; built 2026-10-23, see v1.4)
- **Trees, three species by ground**, chosen in the flora vertex shader from data it already samples (elevation,
  slope, fertility, moisture) plus the per-tuft hash, so neighbours mix at the borders:
  - broadleaf (today's crown) on fertile lowland;
  - conifer on high or steep ground: the same crown vertices reshaped into a tall narrow cone (ring pulled down
    and in, top raised), darker blue-green;
  - flat-top scrub on dry ground: crown flattened and widened, short trunk, olive.
  The crown keeps its 36 vertices, so the flora mesh does not grow (108 vertices × up to 3,500 instances).
- **Crop rows, as contour furrows:** a per-cell field mask (0..1) goes in the unused alpha of `texC`, uploaded
  with biomass every ~16 frames. CPU fills it in the 1 Hz home-clearing pass: cells within `homeClearRadius` of a
  healthy home whose camp knows Farming (the town: `GATE_FARM`), fading out at the edge. The terrain shader draws
  furrow stripes along the contour lines (stripes in elevation) where the mask is set. Flora tufts in fields
  become even-height golden crop and never show trees. No new mesh, no new draw call.
- **Villager role colour at distance:** cloaks are already tinted by role (green forager, tan hauler, blue
  mason, purple mystic). Hide-wearers (camp stage 0-1) get a role-coloured head wrap. Role colours become more
  saturated with camera distance so groups read at island zoom. No new vertices if the head cap is recoloured.
- **Checks:** a `test-geo` check that the flora vertex count is unchanged; a CPU test that the field mask is
  set only around Farming camps' healthy homes; llvmpipe frames of each species, a field and a mixed group;
  then the phone (fps average ≥ 50).

## 7. Save format

- `SAVE_VERSION = 3`. New fields:
  - per villager: `vAlive`, `vAge`, `vLife`, `vCamp`;
  - per camp: all `c*` arrays;
  - per dwelling: `sCamp`;
  - (5b) `kAdopt` and the idea clocks.
- `restoreWorld` returns `{ ok: false, reason: 'old' }` for `v < 3`. `main.js` then starts a fresh primitive world
  and shows a one-line notice ("This island was saved before societies existed; a new one has begun").
  This is the agreed exception to ground rule 3.
- The size budget test stays (fail above ~2 MB).

## 8. Acceptance tests

Seeds for the multi-seed tests: 1337, 7, 4242 (5a); add 99 and 2026 for 5b and 5e.

### 5a
1. Fresh world: `nAlive = 5`, 1 active camp, 1 dwelling, no open Mason orders, no Mason or Mystic roles.
2. Determinism: the same seed after 2,000 substeps gives identical `nAlive`, camp count and villager positions.
3. Growth: on each seed, by 3,600 sim s `nAlive ≥ 12` and at least one split has happened.
4. Stability: on each seed through 7,200 sim s, `nAlive` stays in [1, 120] except during floor-rule gaps, and
   `cHomes ≥ ceil(cPop / household) − 1` for every settled camp (a settling party has no home until it arrives); a
   shortfall shorter than 5 sim s (two homes ruined in one tick, before the 1 Hz recount and rebuild) does not count.
5. Starvation: a camp with `cFood = 0` and foraging blocked loses one member per ~60 s, then becomes inactive.
6. Floor: killing everyone spawns a wandering family of 4 within 60-62 sim s.
7. Heap test: zero allocation in `civStep` with the society code over 5,000 substeps.
8. Persist: v3 round-trip restores identical society state; a v2 payload returns `reason: 'old'`.
9. Render: dead slots produce zero-scale matrices; audit still reports 5 InstancedMesh.

### 5b
1. First discovery ≤ 600 sim s on every seed (mean ≤ 450).
2. An idea discovered in one camp reaches adoption ≥ 0.5 in a camp ≥ 4 units away later, not at once.
3. A camp that stops using an idea for 900 s shows declining adoption.
4. Character: across seeds, Farming is discovered first more often in Pastoral camps than in Industrious ones.

### 5c-5e
1. No Mason work exists before Bridges or Paths is known somewhere.
2. Town scale (≥ 100 people, ≥ 30 homes) is reached at 14,400 sim s ±25% on ≥ 4 of 5 seeds, with no extinction
   lasting past the floor rule.
3. Phone run: 0 errors, fps average ≥ 50.

## 9. Performance

- Society rules run at 1 Hz. Cost ≤ 0.1 ms per `secondTick` on the PRoot test machine (measured by `test-loop`).
- The per-substep villager loop skips dead slots, so an early island is cheaper than today's.
- No `new`, no closures and no array growth in step functions (`test-heap`).

## 10. Open items

- The (tune) numbers in sections 3-5 are first guesses checked only by reasoning. 5a's tests 3-4 and 5e's town-scale
  target decide them.
- Children stay with their camp during a split unless their parents leave. Orphans are not modelled.
- Weather (atmosphere) is render-side only, so the sim cannot use it. Shelter's need uses soil moisture and floods instead.

## Changelog

### v1.5 - 2026-10-23 (audit fixes; Jordan's role, monolith and home-cap decisions)
- Decisions (Jordan, 2026-10-23):
  - **Roles for life:** a Mason stays a Mason, but goes back to foraging once their camp has no open work (checked
    each second, so idle Masons do not hold the island's `maxMasons` places). A Mystic stays one when the camp
    shrinks or splits; only forgetting Ritual ends it. `mysticShare` (10%) now limits new appointments only.
    Foragers and haulers still switch by need. The 5c roles test now checks appointments, not the head count.
  - **Monolith revives are random:** each second a ruin within 2.8 of a monolith revives with chance
    `SOCIETY.monolithRevive` = 0.1, from a stateless hash (world.rng untouched). The town start keeps the old certain
    revive. Before, an abandoned home near a monolith was revived every ~7 s forever and its slot never freed.
  - **Home cap:** `dwellingCap` stays 40 for the island (room for 120-160 people at 3-4 per home). Past it, a camp
    reuses a fully ruined home of its own or of no camp; a camp with fewer than `SOCIETY.smallCampHomes` = 2 homes
    may build a new one anyway, so a fresh split is never homeless (structureCap is 600, so this is safe).
- Audit fixes (`docs/AUDIT-PROMPT.md`, 2026-10-23):
  - F1: `restoreWorld` checks every float is finite, positions within 50, headings within 100, indices and counts
    within their arrays, and small enums in range. The heading turn no longer uses a `while` wrap (a huge value
    hung the step forever, and the bad save reloaded every time); it is written relative to the walking direction,
    so it always stays in range.
  - F2: a half-built work whose Mason dies or leaves reopens for another Mason of its camp, who carries on from
    where it stands (it used to be orphaned forever and block its spot).
  - F4: an abandoned camp's homes get `sCamp = -1`, so a camp that later reuses the index does not inherit them.
  - F5: the furrow shader no longer calls `fwidth` inside a branch; the row width is rebuilt from derivatives of
    elevation and world position taken outside it.
  - F6: the waterfall starts at full flow on the first update that has any outflow (a restored save has none until
    its first substep).
  - F7: saves carry `world.rng`'s state (optional field `rng`) and villager timers on restore are no longer
    `Math.random`, so restores are deterministic.
  - Known gap: a reopened work whose camp dies stays open (no other camp may build it). Rare; left for 5e.
- Test change (5a test 4, Jordan's choice 2026-10-23): a home shortfall counts only if it lasts >= 60 s (was 5 s).
  After these fixes, seed 1337's camp 4 lost a home at 2,548 s when the ground under it dried out (fertility 0.83
  -> 0.16 in ~100 s). The ruin was just below the 0.35 needed to rebuild in place and the ring around the camp was
  too poor for a new site, so it took 33 s to rehouse, with 5,600 food in store. The test is meant to catch a camp
  that never recovers; how fast camps rehouse on poor ground is a 5e question.
- Tests: `test-persist` bad-value rejections, huge-heading step, deterministic restore; `test-society` F2, F3, F4,
  the home cap and both role rules.

### v1.4 - 2026-10-23 (5d-2 built: tree species, crop rows, role colours)
- Trees: the flora vertex shader picks a species per tree from elevation, slope, moisture and fertility plus a
  per-tree jitter: conifer (narrow dark blue-green cone) on high or steep ground, flat-top scrub (wide olive crown,
  taller thinner trunk, 0.8x height) on dry or poor ground, else broadleaf. Only the crown and trunk vertices move;
  the flora mesh stays 108 vertices (`test-geo` check).
  Observed: scrub is rare, because dry or poor ground carries almost no biomass, so few trees stand there to
  show it (one flat-top in the 2,500 s reference frame). Jordan (2026-10-23): leave dry and poor ground as is.
- Fields: `world.field` (runtime only, not saved) is rebuilt in the 1 Hz home-clearing pass: 1 out to 55% of
  `homeClearRadius` around a healthy home whose camp knows Farming (the town: `GATE_FARM`), fading to 0 at the edge.
  It rides in `texC.a` on the biomass upload. The terrain shader draws furrows there; field tufts are even-height
  golden crop and grow no trees. Interpretation: rows follow the contours only on real slopes (gradient above
  ~0.15-0.35); on gentler ground they run straight in a slowly turning direction, because contour stripes on bumpy
  lowland made swirly "fingerprint" patterns in the frames. Rows fade to a flat tone where they would alias.
- Villagers: role colours (green forager, tan hauler, blue Mason, purple Mystic) gain up to 2.3x saturation from
  12 to 40 units of camera distance. Hide-wearers (camp stage 0-1) wear a role-coloured head wrap: the existing
  hood part, recoloured, so the mesh stays 456 vertices.
- No `world.rng` use; the field mask is render-only and does not feed the sim.
- Tests: `test-geo` flora vertex count; `test-society` field mask set only around Farming camps' healthy homes.
- Fix (found by the 5d-2 verify run): the smoke check counts shader programs at frame 1, and waterfalls eased in
  from zero over ~0.6 s of real time, so a quick first frame drew no waterfall and counted 10 programs instead of 11
  (3 of 5 runs right after the long suite; proven by hiding the waterfall at frame 1, which gives exactly 10). The
  waterfall's first update now starts at full flow, so frame 1 no longer depends on timing.

### v1.3 - 2026-10-22 (5d-1 built: homes and villagers by stage)
- 5d is split in two (Jordan, 2026-10-22): 5d-1 homes and villagers (this entry); 5d-2 richer trees, crop rows and
  villager silhouettes, each part checked on the phone.
- Stage 2 and 3 bodies are shared by every culture (Jordan chose "shared body + accent"): stage 2 is a timber cottage
  (plank walls, dark frame, thatch), stage 3 a stone house (dressed stone, slate roof, plinth). The culture adds one
  accent from stage 2: Pastoral windmill, Industrious forge chimney, Mystical crystals. The old full archetype
  buildings (windmill cottage, quarry house, crystal shrine) are gone, so the `?town=1` start now shows stage 2
  timber cottages with accents. Stage 1 is a round wattle hut with a thatch cone.
- `campStage(civ, c)` (society.js) = 3 Stonework, 2 Woodworking, 1 Shelter, else 0; the town is 2. Each home keeps
  the stage it was built at in `sStage` (Uint8, saved). New homes, in-place rebuilds of ruins and revivals (Ritual or
  monolith) take the camp's current stage; a revival never lowers it.
- Upgrades: once a minute per camp (`SOCIETY.upgradeGap` = 60, clock `cUpgT`, saved), the lowest-numbered standing,
  finished home below the camp's stage is rebuilt at it (it rises again from `sBuild` 0.02). No food cost and no
  `world.rng` use, but a home being rebuilt is not a finished home (villagers, decay and paths skip it), so runs
  still diverge from 5c after the first upgrade. A home whose camp forgets an idea keeps its stage.
- Saves: `sStage` and `cUpgT` are optional fields, so a 5c save still loads (its homes take their camp's current
  stage); `SAVE_VERSION` stays 3. A stage above 3 is rejected as corrupt.
- Villagers: cloaks when their own camp is at stage 2+ (was island-wide), hides before. Role tools in the left hand
  when the camp knows the role's idea: forager basket (Baskets), hauler axe (Woodworking), Mason mallet
  (Stonework). Lanterns stay the Mystic's tool, but follow the villager's own camp's Ritual (was island-wide) and
  are still carried by everyone in a Ritual camp. Villager mesh 288 -> 456 vertices (budget 576).
- Tests: `test-society` 5d block (stage follows ideas; older homes upgraded one per 60 s; new homes at the camp
  stage; Stonework gives stage 3) and a stage-range check on the long-run seeds; `test-persist` stage round-trip,
  5c-save fallback and corrupt stage; `test-geo` villager vertex budget.
- Test change (5a test 4): a home shortfall now counts only if it lasts ≥ 5 sim s. With 5d, seed 7 had two homes of
  one camp fall to ruin in the same tick at 5,418 s (one flooded); one was revived within a second, but `cHomes` is
  recounted at 1 Hz, so the per-substep check saw 4 homes for 22 people for ~1 s. The 5c code on the same seed has no
  shortfall; 5d only changed the trajectory. A camp that really fails to rebuild stays short far longer than 5 s.

### v1.2 - 2026-10-22 (5c built)
- The gating map (section 5) is per camp: `campKnows`/`knows` in `knowhow.js`; `campCap(civ, c)` and
  `householdOf(civ, c)` in `society.js`. The island-wide `civ.gates` bits are now recomputed each second as "some camp
  knows it" and only drive island-wide things (lanterns, the monolith and anniversary myths, the order scan's early exit).
- Interpretations:
  - Spoilage is 0.5%/s of the food **above** `campCap × 10`.
  - Farming's "cleared land" is within `homeClearRadius` of one of the camp's own healthy homes.
  - Fire: rest restores 0.5 energy with Fire and 0.33 without. Baskets: forage 0.5 per visit instead of 0.35.
  - Haulers fetch timber only if their camp knows Woodworking, and stone only with Stonework.
  - A work's camp is the nearest settled camp within `supplyRange` that knows its idea (`oCamp`, runtime only).
    Children never become Masons.
  - Mystics: at most `floor(cPop / 10)`, enforced at the 1 Hz recount (surplus or Ritual-less Mystics go back to
    foraging).
  - Player monoliths still revive nearby ruins without Ritual (a player power, not a villager rite).
  - Home models by stage stay in 5d; homes remain hide shelters.
- Anniversary gatherings: only villagers whose camp knows Ritual answer, and each at most once per 120 s. With a myth
  stone for every first discovery (5b), unlimited calls kept small camps at the stones and they starved (seed 4242 died
  out twice in 7,200 s).
- Households stay balanced: a villager who rests at another home of its camp moves in only if that home has room
  (`hCount < householdOf`). Before, households piled into central homes (13 of 17 in one home on seed 7), and a split
  then carried off most of the camp and its food with a single shelter.
- A camp rebuilds its own ruined home in place (if the ground is still dry and fertile) before looking for a new site.
  The ring around a big camp fills up, and the ruin itself blocks the spot.
- Open for 5e: with the unlocks, growth is much faster than 5a. All three test seeds reach 120 people by 2,700-4,500 s
  (target: town scale at ~14,400 s). Food stores grow very large once Storage stops spoilage (~50,000 per camp at
  7,200 s on seed 1337).

### v1.1 - 2026-10-22 (5b built)
- Know-how lives in `src/sim/knowhow.js`, run from `societyTick` once per second. `EV_DISCOVERY` plays three rising
  marimba notes; with `?debug=1` the overlay and console show the latest discovery.
- A split carries the parent's "last used" clocks, not fresh ones (otherwise every split counted as using every idea
  and ideas never faded).
- Discovery draws and discovery myth stones use their own random stream (a stateless hash and the saved `kRngS`),
  so adding know-how does not reshuffle the rest of the sim. Reason: 5a's growth on seeds 7 and 4242 sits right at
  the test thresholds, and any change to `world.rng`'s sequence flipped them (seed 7 lands on exactly 12 people at
  3,600 s). That fragility is 5e's growth-pace work.
- Character: `culturalBias` starts within ±0.1, so without monoliths or buildings every camp is Pastoral. Test 4
  paints the island Industrious (bias -0.6) for the comparison runs. Result: Farming earlier in Pastoral on 4 of 5 seeds.
- Results: first discovery 46-110 s (mean 77); spread seen 7.4 units away ~155 s later; an unused idea goes
  1.00 -> 0.78 over 400 s after the 900 s grace.

### v1.0 - 2026-10-22
- First draft from the 2026-10-21 evaluation and Jordan's grill answers.
