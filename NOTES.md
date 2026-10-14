# Living Mythos — build notes

## Status
- **Current milestone:** M0 done (tooling + empty WebGL2 page). Next: M1 (sim core in Node).
- **Verification so far:** build + static audit + `node --check` of the inlined bundle pass.
  **Not yet run in a browser** (no Chromium in this PRoot). Open `dist/index.html` on-device
  (or `python3 -m http.server` in `dist/`) and expect a rotating normal-shaded octahedron on a dark
  purple background. Add `?debug=1` to log detected GL caps to the console.

## Commands
- `npm run build` → `dist/index.html`; `npm run check` → build + audit; `npm test` → sim tests (M1+).

## Bundler rules (tools/build.mjs)
Local imports `./x.js`; `export const|function|class` only (no default); top-level names unique
across all modules (flat scope after inlining; build fails on duplicates); no import cycles.

## Spec corrections found while building
- `three/addons/misc/Timer.js` does **not** exist in r186 (CDN returns an error); importing it would
  break the whole module. `THREE.Timer` is exported from core `three`. Use `new THREE.Timer()`.
- `PCFSoftShadowMap` still exists in r186 core (spec said removed); we use `PCFShadowMap` anyway.

## Tuning changes
(none yet)

## Known bugs
(none known; untested in browser)
