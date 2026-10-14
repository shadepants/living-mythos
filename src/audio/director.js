import { SCALES, scaleFor, degreeFreq, semiFreq, TIMBRE } from './music.js';
import { sampleGrid } from '../sim/sample.js';
import {
  nextEvent, EV_SCULPT, EV_RAIN_DROP, EV_MONOLITH_PLACE, EV_MONOLITH_PULSE, EV_BUILD_DONE, EV_LANTERN, EV_CHIME, EV_GREET,
  EV_MYTH, EV_ROCKFALL, EV_REVIVE,
} from '../sim/events.js';

// Maps sim events to diegetic music (spec 7). spatial(x, z, out) fills out.pan (-1..1) and out.gain (0..1).
export function createDirector(world) {
  return { cursor: { i: world.events.head }, last: new Float32Array(16), out: { pan: 0, gain: 1 }, rumble: 0, scale: SCALES[0] };
}

function play(eng, d, freq, vel, tim, delay) {
  return eng.trigger(freq, vel * d.out.gain, tim, d.out.pan, delay);
}

export function directorStep(d, world, eng, s, spatial, now) {
  // s: {atmo, bias}; now = performance clock in seconds
  d.scale = scaleFor(s.atmo);
  const sc = d.scale;
  let k;
  d.rumble *= 0.94;
  while ((k = nextEvent(world.events, d.cursor)) >= 0) {
    const t = world.events.type[k], x = world.events.x[k], z = world.events.z[k], a = world.events.a[k];
    spatial(x, z, d.out);
    const bias = sampleGrid(world.culturalBias, x, z);
    if (t === EV_SCULPT) {
      // warm marimba / kalimba pluck pitched by the elevation under the brush
      const e = sampleGrid(world.elev, x, z);
      const deg = Math.max(-3, Math.min(9, Math.round(e * 4.5 - 1)));
      play(eng, d, degreeFreq(sc, deg, bias), a < 0 ? 0.55 : 0.8, TIMBRE.marimba, 0);
      d.rumble = Math.min(1, d.rumble + 0.25);
    } else if (t === EV_RAIN_DROP) {
      if (now - d.last[2] > 0.09 && Math.random() < 0.6) { d.last[2] = now; play(eng, d, degreeFreq(sc, 7 + ((Math.random() * 5) | 0), bias), 0.45, TIMBRE.kalimba, 0); }
    } else if (t === EV_BUILD_DONE) {
      // resonant warm fifth chord
      play(eng, d, semiFreq(sc, 0, bias), 0.8, TIMBRE.warm, 0);
      play(eng, d, semiFreq(sc, 7, bias), 0.7, TIMBRE.warm, 0.02);
      play(eng, d, semiFreq(sc, 12, bias), 0.6, TIMBRE.warm, 0.04);
    } else if (t === EV_MONOLITH_PLACE || t === EV_MONOLITH_PULSE || t === EV_LANTERN) {
      // crystalline bell arpeggio in the upper octave
      const up = t === EV_LANTERN ? 6 : 5;
      for (let j = 0; j < 4; j++) play(eng, d, degreeFreq(sc, up + j * 2 - (j > 2 ? 1 : 0), bias), 0.5 - j * 0.04, TIMBRE.bell, j * 0.09);
    } else if (t === EV_CHIME) {
      if (now - d.last[7] > 0.22) { d.last[7] = now; const n = 2 + ((Math.random() * 2) | 0); for (let j = 0; j < n; j++) play(eng, d, degreeFreq(sc, 8 + ((Math.random() * 4) | 0), bias), 0.32, TIMBRE.bell, j * 0.07); }
    } else if (t === EV_GREET) {
      play(eng, d, degreeFreq(sc, 2, bias), 0.4, TIMBRE.marimba, 0);
      play(eng, d, degreeFreq(sc, 4, bias), 0.34, TIMBRE.marimba, 0.12);
    } else if (t === EV_MYTH) {
      // the myth's own 4-note motif; anniversaries replay it with a root fifth underneath
      const idx = a >= 100 ? a - 100 : a;
      const civ = world.civ;
      const ann = a >= 100;
      for (let j = 0; j < 4; j++) play(eng, d, degreeFreq(sc, 4 + civ.mMotif[idx * 4 + j], bias), 0.5, TIMBRE.bell, j * (ann ? 0.26 : 0.18));
      if (ann) play(eng, d, semiFreq(sc, 7, bias) / 2, 0.5, TIMBRE.warm, 0);
    } else if (t === EV_REVIVE) {
      for (let j = 0; j < 5; j++) play(eng, d, degreeFreq(sc, 3 + j * 2, bias), 0.5, TIMBRE.bell, j * 0.07);
    } else if (t === EV_ROCKFALL) {
      d.rumble = Math.min(1, d.rumble + 0.35);
      if (now - d.last[10] > 0.25) { d.last[10] = now; play(eng, d, 55 * (1 + Math.random() * 0.3), 0.5, TIMBRE.thump, 0); }
    }
  }
}
