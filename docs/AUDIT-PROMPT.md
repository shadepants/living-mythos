# Codebase audit: Living Mythos

You are auditing `~/projects/hobby/living-mythos`: a single-file three.js r186 island simulation (vanilla JS, no
framework). Sources are in `src/` and get bundled into `dist/index.html` by `tools/build.mjs`. Tests and tools are in
`tools/`. Specs: `SPEC.md`, `docs/SPEC-phase5-society.md`, `docs/PLAN-sim-upgrade.md`. Status notes: `NOTES.md`.

## Goal
Find real defects and real risks before Phase 5e (long-run growth tuning). Rank them by impact. This is an audit,
not a refactor: **change nothing**. Report only.

## Ground rules
- Read-only. No edits, commits, branch changes or installs.
- Every finding needs evidence: `file:line`, the code involved, and a concrete case where it goes wrong (input or
  state → wrong result). If you can't name the case, list it under "Questions", not "Findings".
- Keep observations separate from guesses. Say "I verified this by running X" or "inferred from reading".
- A claim that something is never true must say what you searched (e.g. "grep for `world.rng` in src/gl: 0 hits").
- The machine is a phone with little RAM. Don't run `npm run verify` or `npm run society` (40+ min). Fast checks
  are fine: `npm test`, `node tools/test-geo.mjs`, `npm run check`, or a short script on a scratch copy in /tmp.
- Don't report style preferences, naming, or "could use TypeScript". Don't suggest new dependencies.

## Project invariants (check each one; breaking any of these is a finding)
1. **Determinism:** only the main sim may draw from `world.rng`. Know-how and other new subsystems use their own
   stateless hash streams. Growth tests are chaotic on seeds 7 and 4242, so any extra or reordered `world.rng`
   call changes outcomes. Look for render code, UI or debug paths that touch `world.rng` or sim state.
2. **Zero allocation in steps:** sim steps and the frame loop must not allocate (typed arrays are allocated once).
   Look for closures, array literals, `map`/`filter`, object spreads or string building inside per-step or
   per-frame code.
3. **Bundler limits:** all modules share one scope. No `export {..} from`, and no top-level name may repeat across
   modules. Check for collisions and anything that only works because of evaluation order.
4. **Saves:** `SAVE_VERSION` 3, optional fields, rejecting corrupt data, ~2 MB size budget. Check that every saved
   field is restored and bounds-checked, and that runtime-only fields (`field`, `shade`, `pathField`) never leak
   into saves.
5. **Phone GPU limits:** no GPU shadow maps (they lose the WebGL context on PowerVR). Fixed vertex budgets (flora
   108, villager ≤ 576). Texture uploads on their set cadence, never every frame. Flag anything that adds draw
   calls, programs or per-frame uploads.
6. **Frozen TUNING:** values in `src/sim/tuning.js` are frozen. Flag code that mutates them or works around them
   with hidden constants.
7. **Test honesty:** look for tests that can't fail, check the wrong quantity, depend on timing (like the old
   frame-1 waterfall flake), or whose thresholds no longer match the spec.

## Also look for
- Edge cases in the society sim: camps going to 0 or 8, ruined or decaying homes, index reuse after deaths, NaN or
  Infinity from divisions by population or distance, grid edges (x/z at 0 or 127).
- Mismatches between what the spec says and what the code does (quote both).
- Dead code, unused uniforms or attributes, stale comments that contradict the code.
- Shader precision on mobile (mediump), divisions by zero, and `fwidth`/derivative use inside branches.
- Performance hot spots, with an estimate (e.g. "O(nS²) in secondTick, nS up to N").

## Output
1. **Summary**: 3-5 lines on overall health and the top risks.
2. **Findings**, most severe first. For each: severity (critical / high / medium / low), `file:line`, what's wrong,
   the failing case, evidence (verified or inferred), and the smallest fix.
3. **Invariant checklist**: invariants 1-7, each pass / fail / unsure, with one line of evidence.
4. **Questions**: things that look wrong but need the author's intent.
5. **Not reviewed**: anything you skipped and why.

Aim for fewer, well-proven findings over many weak ones.

For Gemini (no shell): upload a text bundle of `src/`, `tools/` and the specs, and skip the "run" lines.
