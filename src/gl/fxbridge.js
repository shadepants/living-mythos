import { SHARED } from './shared.js';
import { nextEvent, EV_SCULPT, EV_MONOLITH_PLACE, EV_MONOLITH_PULSE, EV_BUILD_DONE, EV_REVIVE } from '../sim/events.js';

// Turns sim events into expanding shader ring waves (8 slots, oldest replaced).
export function createRingFx(world) {
  const cursor = { i: world.events.head };
  let slot = 0;
  const birth = new Float32Array(8).fill(-100);
  const life = new Float32Array(8);

  function add(x, z, kind, strength, life_, speed) {
    const k = slot; slot = (slot + 1) % 8;
    SHARED.uRingA.value[k].set(x, z, SHARED.uTime.value, kind);
    SHARED.uRingB.value[k].set(strength, life_, speed, 0);
    birth[k] = SHARED.uTime.value; life[k] = life_;
  }

  return {
    add,
    update() {
      let k;
      while ((k = nextEvent(world.events, cursor)) >= 0) {
        const t = world.events.type[k], x = world.events.x[k], z = world.events.z[k];
        if (t === EV_SCULPT) add(x, z, 0, 0.42, 1.5, 4.0);
        else if (t === EV_MONOLITH_PLACE) add(x, z, 1, 0.8, 2.8, 5.0);
        else if (t === EV_MONOLITH_PULSE) add(x, z, 1, 0.5, 3.2, 4.2);
        else if (t === EV_BUILD_DONE) add(x, z, 2, 0.45, 1.6, 3.0);
        else if (t === EV_REVIVE) add(x, z, 1, 0.65, 2.4, 4.5);
      }
      for (let s = 0; s < 8; s++) if (SHARED.uTime.value - birth[s] > life[s]) SHARED.uRingB.value[s].x = 0;
    },
  };
}
