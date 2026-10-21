const M = window.__mythos; M.advance(480);
const c = M.world.civ; let s = 0; for (; s < c.nS; s++) if (c.sKind[s] === 0 && c.sDecay[s] < 0.3) break;
const x = c.sX[s], z = c.sZ[s], gx = Math.round((x + 10) / 20 * 128 - 0.5), gz = Math.round((z + 10) / 20 * 128 - 0.5);
const y = M.world.elev[gz * 128 + gx];
M.controls.target.set(x, y + 0.2, z); M.camera.position.set(x + 2.2, y + 1.6, z + 2.6); M.controls.update();
