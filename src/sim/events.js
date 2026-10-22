// Fixed-size event ring shared by renderer, particles and audio. Consumers keep their own cursor {i}.
export const EV_SCULPT = 1;
export const EV_RAIN_DROP = 2;
export const EV_MONOLITH_PLACE = 3;
export const EV_MONOLITH_PULSE = 4;
export const EV_BUILD_DONE = 5;
export const EV_LANTERN = 6;
export const EV_CHIME = 7;
export const EV_GREET = 8;
export const EV_MYTH = 9;
export const EV_ROCKFALL = 10;
export const EV_DUST = 11;
export const EV_REVIVE = 12;
export const EV_DISCOVERY = 13;   // a = camp * 10 + idea (Phase 5b)

export const EVENT_CAP = 128;

export function createEventRing() {
  return { type: new Uint8Array(EVENT_CAP), x: new Float32Array(EVENT_CAP), z: new Float32Array(EVENT_CAP), a: new Float32Array(EVENT_CAP), head: 0 };
}

export function emitEvent(ring, type, x, z, a) {
  const k = ring.head % EVENT_CAP;
  ring.type[k] = type; ring.x[k] = x; ring.z[k] = z; ring.a[k] = a;
  ring.head++;
}

// Cursor object {i} starts at ring.head when the consumer is created. Returns the next unread slot index or -1.
export function nextEvent(ring, cursor) {
  if (ring.head - cursor.i > EVENT_CAP) cursor.i = ring.head - EVENT_CAP;
  if (cursor.i >= ring.head) return -1;
  const k = cursor.i % EVENT_CAP;
  cursor.i++;
  return k;
}
