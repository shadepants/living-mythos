import * as THREE from 'three';
import { SHARED } from '../gl/shared.js';
import { raymarchHeightfield } from '../sim/sample.js';
import { sculptAt, rainAt, placeMonolith } from '../sim/tools.js';
import { emitEvent, EV_SCULPT, EV_RAIN_DROP, EV_CHIME, EV_ROCKFALL } from '../sim/events.js';

export const TOOL_SCULPT = 0, TOOL_CLOUD = 1, TOOL_MONOLITH = 2, TOOL_BREEZE = 3;
const OMEGA = 18.0, ZETA = 1.0;          // critically damped spring (spec 6.1)
const HOLD_MS = 400, TAP_MS = 300, MOVE_PX = 10;
const CLOUD_HOVER = 2.9;

// Pointer/touch input, analytical raymarch cursor, spring filtering, and tool application.
export function createController(o) {
  const { canvas, camera, controls, world, cloud, onChange } = o;
  const st = {
    tool: TOOL_SCULPT, active: false, alt: false, isTouch: false, touches: 0,
    downX: 0, downY: 0, downT: 0, moved: false, holdTimer: 0,
    burstT: 0, burstAlt: false,
    lastX: 0, lastY: 0, hasPointer: false, hitOk: false,
    hit: { x: 0, y: 0, z: 0 }, spos: new Float64Array(3), svel: new Float64Array(3), sInit: false,
    alpha: 0, cloudVis: 0, rainAmt: 0, breezeAmt: 0,
    stats: { touchDown: 0, mouseDown: 0, tap: 0, hold: 0, multi: 0, moved: 0, onIsland: 0, offIsland: 0, pinch: 0, orbit: 0, log: [] },
    sculptClock: 0, rockClock: 0, dropClock: 0, chimeClock: 0, placedThisPress: false, radius: 1.5,
  };
  const v = new THREE.Vector3(), dir = new THREE.Vector3();
  const cA = new THREE.Color(1.0, 0.78, 0.38), cB = new THREE.Color(0.55, 0.6, 1.0), cC = new THREE.Color(0.45, 0.9, 1.0), cD = new THREE.Color(1.0, 0.85, 0.45), cE = new THREE.Color(0.7, 1.0, 0.85);

  const note = (what) => { const L = st.stats.log; if (L.length >= 40) L.shift(); L.push(what + '@' + Math.round(performance.now() / 100) / 10); };

  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    v.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5);
    camera.updateMatrixWorld();
    v.unproject(camera);
    dir.copy(v).sub(camera.position).normalize();
    const ok = raymarchHeightfield(world.elev, camera.position.x, camera.position.y, camera.position.z, dir.x, dir.y, dir.z, st.hit);
    // the cliff band is not a place to act on
    st.hitOk = ok && Math.hypot(st.hit.x, st.hit.z) < 8.7;
    return st.hitOk;
  }

  function beginAction(alt) {
    st.active = true; st.alt = alt; st.placedThisPress = false;
    controls.enabled = false;
  }
  function endAction() {
    st.active = false; st.placedThisPress = false;
    controls.enabled = true;
  }

  function onDown(e) {
    st.lastX = e.clientX; st.lastY = e.clientY; st.hasPointer = true;
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    st.isTouch = touch;
    if (touch) st.stats.touchDown++; else st.stats.mouseDown++;
    if (!touch) {
      const onIsland = pick(e.clientX, e.clientY);
      const modifier = e.ctrlKey || e.altKey || e.metaKey;
      if (e.button === 0 && onIsland && !modifier) { beginAction(e.shiftKey); try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } }
      else if (e.button === 2 && onIsland && !modifier) { beginAction(true); try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } }
      else controls.enabled = true;
      return;
    }
    st.touches++;
    if (st.touches > 1) { st.stats.multi++; note('multi-touch'); clearTimeout(st.holdTimer); st.downT = 0; endAction(); return; }   // pinch / two-finger pan belongs to the camera
    st.downX = e.clientX; st.downY = e.clientY; st.downT = performance.now(); st.moved = false;
    clearTimeout(st.holdTimer);
    if (pick(e.clientX, e.clientY)) {
      st.stats.onIsland++;
      st.holdTimer = setTimeout(() => { if (st.touches === 1 && !st.moved && pick(st.lastX, st.lastY)) { st.stats.hold++; note('hold-carve'); beginAction(true); } }, HOLD_MS);
    } else st.stats.offIsland++;
  }

  function onMove(e) {
    st.lastX = e.clientX; st.lastY = e.clientY; st.hasPointer = true;
    if (st.isTouch && st.touches === 1 && !st.moved && Math.hypot(e.clientX - st.downX, e.clientY - st.downY) > MOVE_PX) {
      st.moved = true; st.stats.moved++; note('drag'); clearTimeout(st.holdTimer);
    }
  }

  function onUp(e) {
    if (e.pointerType === 'mouse') { if (st.active) endAction(); return; }
    st.touches = Math.max(0, st.touches - 1);
    clearTimeout(st.holdTimer);
    if (st.active) { endAction(); return; }
    // a quick, stationary single touch is a tap with the current tool
    if (st.touches === 0 && st.downT && !st.moved && performance.now() - st.downT < TAP_MS) {
      if (pick(e.clientX, e.clientY)) { st.stats.tap++; note('tap:tool' + st.tool); tapAction(); }
    }
    st.downT = 0;
    if (st.touches === 0) { controls.enabled = true; st.hasPointer = st.isTouch ? false : st.hasPointer; }
  }

  function tapAction() {
    st.sInit = false;                 // snap the cursor spring to the tapped spot
    st.spos[0] = st.hit.x; st.spos[1] = st.hit.y; st.spos[2] = st.hit.z; st.svel.fill(0); st.sInit = true;
    if (st.tool === TOOL_SCULPT) { st.burstT = 0.3; st.burstAlt = false; }
    else if (st.tool === TOOL_CLOUD) { st.burstT = 2.5; st.burstAlt = false; }
    else if (st.tool === TOOL_MONOLITH) { placeMonolith(world, st.hit.x, st.hit.z); }
    else { st.burstT = 1.6; st.burstAlt = false; emitEvent(world.events, EV_CHIME, st.hit.x, st.hit.z, 1); }
  }

  function onLeave(e) { if (e.pointerType === 'mouse') st.hasPointer = false; }
  function onCancel() { st.touches = 0; clearTimeout(st.holdTimer); endAction(); st.hasPointer = false; }

  canvas.addEventListener('pointerdown', onDown, { capture: true });
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', onCancel);

  function setTool(i) {
    st.tool = i;
    st.burstT = 0;
    if (onChange) onChange(i);
  }

  // Critically damped second-order follower for one axis (semi-implicit Euler, 2 substeps).
  function spring(axis, target, dt) {
    const h = dt * 0.5;
    for (let s = 0; s < 2; s++) {
      const a = -OMEGA * OMEGA * (st.spos[axis] - target) - 2 * ZETA * OMEGA * st.svel[axis];
      st.svel[axis] += a * h;
      st.spos[axis] += st.svel[axis] * h;
    }
  }

  function update(dt, time) {
    if (st.hasPointer) pick(st.lastX, st.lastY);
    else st.hitOk = false;
    if (st.hitOk) {
      if (!st.sInit) { st.spos[0] = st.hit.x; st.spos[1] = st.hit.y; st.spos[2] = st.hit.z; st.svel.fill(0); st.sInit = true; }
      spring(0, st.hit.x, dt); spring(1, st.hit.y, dt); spring(2, st.hit.z, dt);
    } else if (st.burstT <= 0 && !st.active) st.sInit = st.sInit && st.alpha > 0.02;

    const using = st.active || st.burstT > 0;
    const alt = st.active ? st.alt : st.burstAlt;
    if (st.burstT > 0) st.burstT -= dt;
    const sx = st.spos[0], sy = st.spos[1], sz = st.spos[2];
    const showing = st.sInit && (st.hitOk || using);
    st.alpha += ((showing ? 1 : 0) - st.alpha) * Math.min(1, dt * 10);

    // cursor look per tool
    const u = SHARED.uCursor.value;
    const tool = st.tool;
    st.radius = tool === TOOL_SCULPT ? 1.5 : tool === TOOL_CLOUD ? 1.7 : tool === TOOL_MONOLITH ? 0.7 : 2.4;
    u.set(sx, sy, sz, st.radius * (1 + (using ? 0.06 * Math.sin(time * 14) : 0)));
    SHARED.uCursorCol.value.copy(tool === TOOL_SCULPT ? (alt ? cB : cA) : tool === TOOL_CLOUD ? cC : tool === TOOL_MONOLITH ? cD : cE);
    SHARED.uCursorA.value = st.alpha * (using ? 1.0 : 0.75);

    // tool effects (applied at the spring-filtered position)
    let rain = 0, breeze = 0;
    if (tool === TOOL_SCULPT && using && st.sInit) {
      sculptAt(world, sx, sz, st.radius, (alt ? -1 : 1) * 0.9 * dt);
      st.sculptClock += dt; st.rockClock += dt;
      if (st.sculptClock > 0.28) { st.sculptClock = 0; emitEvent(world.events, EV_SCULPT, sx, sz, alt ? -1 : 1); }
      if (st.rockClock > 0.2) { st.rockClock = 0; emitEvent(world.events, EV_ROCKFALL, sx, sz, alt ? -1 : 1); }
    } else if (tool === TOOL_CLOUD && using && st.sInit) {
      rain = 1;
      rainAt(world, sx, sz, 1.6, dt);
      st.dropClock += dt;
      if (st.dropClock > 0.16) { st.dropClock = 0; emitEvent(world.events, EV_RAIN_DROP, sx + (Math.random() - 0.5), sz + (Math.random() - 0.5), 1); }
    } else if (tool === TOOL_MONOLITH && st.active && !st.placedThisPress && st.hitOk) {
      placeMonolith(world, st.hit.x, st.hit.z);
      st.placedThisPress = true;
    } else if (tool === TOOL_BREEZE && (st.hitOk && !st.isTouch || using) && st.sInit) {
      breeze = 1;
      st.chimeClock += dt;
      const sp = Math.hypot(st.svel[0], st.svel[2]);
      if (sp > 1.4 && st.chimeClock > 0.45) { st.chimeClock = 0; emitEvent(world.events, EV_CHIME, sx, sz, Math.min(1, sp / 6)); }
    }

    // cloud + wind shaders
    const cloudTarget = tool === TOOL_CLOUD && (st.hitOk || using) ? 1 : 0;
    st.cloudVis += (cloudTarget - st.cloudVis) * Math.min(1, dt * 4);
    st.rainAmt += (rain - st.rainAmt) * Math.min(1, dt * 5);
    st.breezeAmt += (breeze - st.breezeAmt) * Math.min(1, dt * 6);
    if (cloud) cloud.userData.update(time, sx, sy + CLOUD_HOVER, sz, st.cloudVis);
    SHARED.uCloud.value.set(sx, sz, 2.6, st.rainAmt);
    SHARED.uBreeze.value.set(sx, sz, 2.6, st.breezeAmt);

    // keep the camera target on the island
    const t = controls.target;
    const rr = Math.hypot(t.x, t.z);
    if (rr > 6) { t.x *= 6 / rr; t.z *= 6 / rr; }
    if (t.y < -1) t.y = -1; else if (t.y > 2) t.y = 2;
  }

  return { st, setTool, update };
}
