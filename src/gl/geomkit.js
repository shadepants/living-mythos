import * as THREE from 'three';

// Tiny low-poly builder. Every vertex carries aPart = (part id, second parameter) for the shaders.
export function kitNew() { return { pos: [], part: [] }; }

function kitTri(b, a, c, d, pid, ya, yc, yd) {
  b.pos.push(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
  b.part.push(pid, ya, pid, yc, pid, yd);
}

// yOf(y) maps a local y to the second part parameter (normalised height, or a fixed t for stairs).
export function kitBox(b, cx, cy, cz, sx, sy, sz, pid, yOf) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const q = (a, c, d, e) => { kitTri(b, v[a], v[c], v[d], pid, yOf(v[a][1]), yOf(v[c][1]), yOf(v[d][1])); kitTri(b, v[a], v[d], v[e], pid, yOf(v[a][1]), yOf(v[d][1]), yOf(v[e][1])); };
  q(0, 1, 2, 3); q(5, 4, 7, 6); q(4, 0, 3, 7); q(1, 5, 6, 2); q(3, 2, 6, 7); q(4, 5, 1, 0);
}

export function kitFrustum(b, cx, y0, cz, r0, r1, h, sides, pid, yOf, rot) {
  const ring = (r, y) => { const o = []; for (let k = 0; k < sides; k++) { const a = (k / sides) * Math.PI * 2 + (rot || 0); o.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]); } return o; };
  const lo = ring(r0, y0), hi = ring(r1, y0 + h);
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    kitTri(b, lo[k], lo[k1], hi[k], pid, yOf(y0), yOf(y0), yOf(y0 + h));
    kitTri(b, lo[k1], hi[k1], hi[k], pid, yOf(y0), yOf(y0 + h), yOf(y0 + h));
    kitTri(b, hi[k], hi[k1], [cx, y0 + h, cz], pid, yOf(y0 + h), yOf(y0 + h), yOf(y0 + h));
    kitTri(b, lo[k1], lo[k], [cx, y0, cz], pid, yOf(y0), yOf(y0), yOf(y0));
  }
}

export function kitPyramid(b, cx, y0, cz, r, h, sides, pid, yOf, rot) {
  const ring = [];
  for (let k = 0; k < sides; k++) { const a = (k / sides) * Math.PI * 2 + (rot || 0); ring.push([cx + Math.cos(a) * r, y0, cz + Math.sin(a) * r]); }
  const tip = [cx, y0 + h, cz];
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    kitTri(b, ring[k], ring[k1], tip, pid, yOf(y0), yOf(y0), yOf(y0 + h));
    kitTri(b, ring[k1], ring[k], [cx, y0, cz], pid, yOf(y0), yOf(y0), yOf(y0));
  }
}

// Triangular prism roof; ridge runs along z. w = span in x, d = length in z.
export function kitRoof(b, cx, y0, cz, w, h, d, pid, yOf) {
  const l0 = [cx - w / 2, y0, cz - d / 2], l1 = [cx - w / 2, y0, cz + d / 2], r0 = [cx + w / 2, y0, cz - d / 2], r1 = [cx + w / 2, y0, cz + d / 2];
  const t0 = [cx, y0 + h, cz - d / 2], t1 = [cx, y0 + h, cz + d / 2];
  const yb = yOf(y0), yt = yOf(y0 + h);
  kitTri(b, l0, l1, t1, pid, yb, yb, yt); kitTri(b, l0, t1, t0, pid, yb, yt, yt);
  kitTri(b, r1, r0, t0, pid, yb, yb, yt); kitTri(b, r1, t0, t1, pid, yb, yt, yt);
  kitTri(b, l0, t0, r0, pid, yb, yt, yb); kitTri(b, l1, r1, t1, pid, yb, yb, yt);
}

export function kitFinish(b) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(b.part, 2));
  g.computeVertexNormals();
  return g;
}
