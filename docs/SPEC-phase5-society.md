---
Title: Living Mythos Phase 5: Society from one family
Type: Tech Spec
Version: 1.0
Status: Approved
Owner: Jordan
Created: 2026-10-22
Last Updated: 2026-10-22
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
   `cHomes ≥ ceil(cPop / 3) − 1` for every settled camp (a settling party has no home until it arrives).
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

### v1.0 - 2026-10-22
- First draft from the 2026-10-21 evaluation and Jordan's grill answers.
