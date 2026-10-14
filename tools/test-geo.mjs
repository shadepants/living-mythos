// Geometry sanity tests that need three but no GPU (run: node tools/test-geo.mjs).
import { createGridGeometry, createBasaltSkirt } from '../src/gl/terrain.js';

let failed = 0;
const check = (name, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? '  — ' + d : ''}`); if (!ok) failed++; };

{
  const g = createGridGeometry();
  const p = g.attributes.position.array, ix = g.index.array;
  let up = 0, down = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    const e1y = [p[b] - p[a], p[b + 2] - p[a + 2]], e2y = [p[c] - p[a], p[c + 2] - p[a + 2]];
    // cross product y component of (e1 x e2) for vectors in the xz plane: e1.z*e2.x - e1.x*e2.z
    const ny = e1y[1] * e2y[0] - e1y[0] * e2y[1];
    if (ny > 0) up++; else down++;
  }
  check('grid triangles all face +Y', down === 0 && up > 30000, `up ${up}, down ${down}`);
  const minX = Math.min(...Array.from({ length: 128 }, (_, i) => p[i * 3]));
  check('grid spans ~[-10,10] at cell centres', Math.abs(minX + 10 - 20 / 256) < 1e-5, `minX ${minX}`);
}

{
  const sk = createBasaltSkirt();
  const g = sk.geometry;
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  let out = 0, inn = 0, minY = 0, topMaxR = 0, topMinR = 99;
  for (let i = 0; i < p.length; i += 9) {
    const cx = (p[i] + p[i + 3] + p[i + 6]) / 3, cz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
    const len = Math.hypot(cx, cz);
    if (len < 1e-6) continue;
    const dot = (n[i] * cx + n[i + 2] * cz) / len;
    if (dot > 0) out++; else inn++;
  }
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 1] < minY) minY = p[i + 1];
    if (Math.abs(p[i + 1] + 0.6) < 1e-6) { const r = Math.hypot(p[i], p[i + 2]); topMaxR = Math.max(topMaxR, r); topMinR = Math.min(topMinR, r); }
  }
  check('skirt normals face outward', inn === 0 && out > 800, `out ${out}, in ${inn}`);
  check('skirt tip at y = -9.5', Math.abs(minY + 9.5) < 1e-4, `minY ${minY}`);
  check('skirt top ring meets island rim (r = 9.2, y = -0.6)', Math.abs(topMaxR - 9.2) < 1e-4 && Math.abs(topMinR - 9.2) < 1e-4, `r ${topMinR}..${topMaxR}`);
}

if (failed) { console.error(`${failed} geometry test(s) failed`); process.exit(1); }
console.log('geometry tests passed');
