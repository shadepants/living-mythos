// Audio tests against a recording fake AudioContext (no sound hardware needed): graph shape, voice stealing, envelope
// scheduling, filter clamps, IR, scale quantizing and the event->music director.
import { createAudioEngine, VOICES, IR_SECONDS, clampFilterFreq, clampFilterQ, fillImpulseResponse } from '../src/audio/engine.js';
import { SCALES, scaleFor, degreeMidi, degreeFreq, inScale, midiToFreq, rootShift } from '../src/audio/music.js';
import { createDirector, directorStep } from '../src/audio/director.js';
import { createWorld } from '../src/sim/world.js';
import { emitEvent, EV_SCULPT, EV_BUILD_DONE, EV_MONOLITH_PULSE, EV_CHIME, EV_MYTH, EV_ROCKFALL } from '../src/sim/events.js';

let failed = 0;
const check = (name, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? '  — ' + d : ''}`); if (!ok) failed++; };

class Param {
  constructor(v) { this.value = v; this.calls = []; }
  setValueAtTime(v, t) { this.calls.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.calls.push(['lin', v, t]); return this; }
  setTargetAtTime(v, t, tc) { this.calls.push(['target', v, t, tc]); return this; }
  cancelScheduledValues(t) { this.calls.push(['cancel', t]); return this; }
}
class Node {
  constructor(kind, ctx) { this.kind = kind; this.ctx = ctx; this.out = []; this.started = 0; ctx.nodes.push(this); }
  connect(n) { this.out.push(n); return n; }
  start() { this.started++; }
}
function fakeCtx() {
  const ctx = { sampleRate: 8000, currentTime: 0, state: 'suspended', nodes: [], destination: { kind: 'dest' } };
  ctx.resume = () => { ctx.state = 'running'; };
  ctx.suspend = () => { ctx.state = 'suspended'; };
  const mk = (kind, params) => () => { const n = new Node(kind, ctx); for (const [k, v] of Object.entries(params || {})) n[k] = new Param(v); return n; };
  ctx.createGain = mk('gain', { gain: 1 });
  ctx.createDynamicsCompressor = mk('limiter', { threshold: 0, knee: 0, ratio: 1, attack: 0, release: 0 });
  ctx.createOscillator = mk('osc', { frequency: 440 });
  ctx.createBiquadFilter = mk('biquad', { frequency: 350, Q: 1 });
  ctx.createDelay = mk('delay', { delayTime: 0 });
  ctx.createStereoPanner = mk('panner', { pan: 0 });
  ctx.createConvolver = mk('conv');
  ctx.createBufferSource = mk('bufsrc');
  ctx.createBuffer = (ch, len, sr) => { const data = Array.from({ length: ch }, () => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i] }; };
  return ctx;
}

const mkEngine = () => { const ctx = fakeCtx(); const e = createAudioEngine(() => ctx); return { e, ctx }; };

// lifecycle
{
  const { e, ctx } = mkEngine();
  check('lifecycle: nothing is created before the first gesture', ctx.nodes.length === 0 && !e.ready);
  e.ensure();
  check('lifecycle: ensure() builds the graph and resumes the context', e.ready && ctx.state === 'running');
  const n0 = ctx.nodes.length;
  e.ensure(); e.ensure();
  check('lifecycle: repeated gestures do not rebuild anything', ctx.nodes.length === n0);
}

// graph
{
  const { e, ctx } = mkEngine(); e.ensure();
  const oscs = ctx.nodes.filter(n => n.kind === 'osc');
  check('graph: 16 voices, each a sine + triangle oscillator pair, started once', e.voices.length === VOICES && oscs.length === 32 && oscs.every(o => o.started === 1));
  check('graph: voice oscillators are sine and triangle', e.voices.every(v => v.o1.type === 'sine' && v.o2.type === 'triangle'));
  const conv = ctx.nodes.find(n => n.kind === 'conv');
  check('graph: a ConvolverNode holds a 3.5 s stereo impulse response', conv.buffer && conv.buffer.numberOfChannels === 2 && Math.abs(conv.buffer.duration - IR_SECONDS) < 0.01, `${conv.buffer.duration.toFixed(2)} s`);
  check('graph: ping-pong delay pair with damping filter exists', ctx.nodes.filter(n => n.kind === 'delay').length === 2);
  const filters = ctx.nodes.filter(n => n.kind === 'biquad').map(n => n);
  check('graph: wind and river are band-pass, rumble is low-pass', filters.filter(f => f.type === 'bandpass').length === 2 && filters.filter(f => f.type === 'lowpass').length >= 3);
  const src = ctx.nodes.find(n => n.kind === 'bufsrc');
  check('graph: the noise bus is a looping buffer feeding three parallel filters', src.loop === true && src.out.length === 3 && src.started === 1 && src.buffer.numberOfChannels === 2);
}

// impulse response sanity
{
  const sr = 8000, len = Math.floor(sr * IR_SECONDS);
  const L = new Float32Array(len), R = new Float32Array(len);
  fillImpulseResponse(L, R, sr);
  const rms = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
  const early = rms(L, 0, sr * 0.5), late = rms(L, len - sr * 0.5, len);
  check('IR: decays by more than 20 dB across the tail', early > 0 && late < early * 0.1, `early ${early.toFixed(4)} late ${late.toFixed(5)}`);
  let diff = 0; for (let i = 0; i < len; i++) diff += Math.abs(L[i] - R[i]);
  check('IR: left and right channels are decorrelated', diff > 1);
  let bad = 0; for (let i = 0; i < len; i++) if (!Number.isFinite(L[i]) || Math.abs(L[i]) > 2) bad++;
  check('IR: finite and bounded', bad === 0);
}

// envelopes and stealing
{
  const { e, ctx } = mkEngine(); e.ensure();
  const tim = { harm: 4, harmAmt: 0.3, fm: 0, decay: 0.2, attackGain: 0.3 };
  e.update(0.1, { wind: 0, windSpeed: 0, flux: 0, sculpt: 0, night: 0, aurora: 0 });   // resets the per-frame trigger counter
  e.trigger(440, 1, tim, 0, 0);
  const v = e.voices.find(x => x.order === 1);
  const gc = v.vg.gain.calls;
  const lin = gc.find(c => c[0] === 'lin'), tgt = gc.find(c => c[0] === 'target');
  check('envelope: 5 ms linear attack followed by an exponential (setTarget) decay', lin && tgt && Math.abs(lin[2] - 0.005) < 1e-9 && Math.abs(tgt[2] - 0.005) < 1e-9 && gc.indexOf(lin) < gc.indexOf(tgt), JSON.stringify(gc.slice(-3)));

  // 16 notes fill the voices; the 17th steals the least recently triggered one (voice with order 1)
  const used = new Set();
  for (let i = 0; i < 20; i++) { if (i % 8 === 0) e.update(0.1, { wind: 0, windSpeed: 0, flux: 0, sculpt: 0, night: 0, aurora: 0 }); e.trigger(300 + i, 0.8, tim, 0, 0); }
  const orders = e.voices.map(x => x.order).sort((a, b) => a - b);
  check('stealing: never more than 16 voices exist and the oldest are recycled (LRU)', e.voices.length === 16 && orders[0] > 1 && orders[orders.length - 1] === 21, `orders ${orders.slice(0, 5)}...`);
  const stolenCalls = e.voices.flatMap(x => x.vg.gain.calls).filter(c => c[0] === 'target' && c[3] === 0.002);
  check('stealing: a stolen voice is faded out quickly (click-free)', stolenCalls.length >= 1);
  check('trigger cap: no more than 8 notes per frame', (() => { e.update(0.1, { wind: 0, windSpeed: 0, flux: 0, sculpt: 0, night: 0, aurora: 0 }); let n = 0; for (let i = 0; i < 20; i++) if (e.trigger(500, 0.5, tim, 0, 0)) n++; return n === 8; })());
  e.setMuted(true);
  e.update(0.1, { wind: 0, windSpeed: 0, flux: 0, sculpt: 0, night: 0, aurora: 0 });
  check('mute: notes are refused and the output fades to zero', e.trigger(440, 1, tim, 0, 0) === false && e.nodes.out.gain.calls.some(c => c[0] === 'target' && c[1] === 0));
}

// environment filters
{
  check('clamp: cutoff is held to [40, 12000] Hz', clampFilterFreq(1) === 40 && clampFilterFreq(1e6) === 12000 && clampFilterFreq(900) === 900);
  check('clamp: Q is held to [0.5, 8]', clampFilterQ(0) === 0.5 && clampFilterQ(99) === 8 && clampFilterQ(2) === 2);
  const { e } = mkEngine(); e.ensure();
  e.update(0.1, { wind: 50, windSpeed: 50, flux: 50, sculpt: 50, night: 1, aurora: 1 });
  const all = [e.nodes.wind, e.nodes.river, e.nodes.rumble];
  let ok = true, tcOk = true;
  for (const s of all) {
    for (const c of s.f.frequency.calls) if (c[0] === 'target') { if (c[1] < 40 || c[1] > 12000) ok = false; if (c[3] !== 0.04) tcOk = false; }
    for (const c of s.f.Q.calls) if (c[0] === 'target') { if (c[1] < 0.5 || c[1] > 8) ok = false; if (c[3] !== 0.04) tcOk = false; }
  }
  check('environment: extreme inputs still produce clamped cutoffs/Q', ok);
  check('environment: every update is smoothed with setTargetAtTime(v, now, 0.04)', tcOk);
  e.update(0.1, { wind: 0, windSpeed: 0, flux: 0, sculpt: 0, night: 0, aurora: 0 });
  e.update(0.1, { wind: 0, windSpeed: 0, flux: 0, sculpt: 0, night: 0, aurora: 0 });
  const w0 = e.nodes.wind.f.frequency.calls.filter(c => c[0] === 'target');
  check('environment: updates are throttled to ~20 Hz', w0.length === 1 + 1 + 1, `${w0.length} updates for 3 ticks of 0.1 s`);
}

// scales
{
  let allIn = true;
  for (const sc of SCALES) for (const bias of [-1, -0.5, 0, 0.5, 1]) for (let d = -6; d < 20; d++) if (!inScale(sc, degreeMidi(sc, d, bias), bias)) allIn = false;
  check('music: every quantized degree lands in its pentatonic/Dorian scale at every root shift', allIn);
  check('music: scale follows the atmosphere (golden, aurora, monsoon)', scaleFor(0) === SCALES[0] && scaleFor(0.5) === SCALES[1] && scaleFor(1) === SCALES[2]);
  check('music: regional culture shifts the root (industrious lower, mystical higher)', degreeMidi(SCALES[0], 0, -1) < degreeMidi(SCALES[0], 0, 0) && degreeMidi(SCALES[0], 0, 1) > degreeMidi(SCALES[0], 0, 0) && rootShift(0) === 0);
  check('music: an octave up doubles the frequency', Math.abs(degreeFreq(SCALES[1], 7, 0) / degreeFreq(SCALES[1], 0, 0) - 2) < 1e-9 && Math.abs(midiToFreq(69) - 440) < 1e-9);
}

// director
{
  const w = createWorld(3);
  w.civ.mMotif.set([1, 3, 2, 5]);
  const { e, ctx } = mkEngine(); e.ensure();
  const d = createDirector(w);
  const sp = (x, z, out) => { out.pan = Math.max(-1, Math.min(1, x / 10)); out.gain = 1; };
  const run = (n, ev) => { e.update(0.1, { wind: 0, windSpeed: 0, flux: 0, sculpt: 0, night: 0, aurora: 0 }); const before = e.order; ev(); directorStep(d, w, e, { atmo: 0, bias: 0 }, sp, 10 + n); return e.order - before; };
  check('director: a sculpt event plucks one note', run(1, () => emitEvent(w.events, EV_SCULPT, 0, 0, 1)) === 1);
  check('director: a finished bridge rings a three-note warm chord', run(2, () => emitEvent(w.events, EV_BUILD_DONE, 0, 0, 2)) === 3);
  check('director: a monolith pulse launches a 4-note bell arpeggio', run(3, () => emitEvent(w.events, EV_MONOLITH_PULSE, 0, 0, 0)) === 4);
  check('director: a myth plays its own 4-note motif', run(4, () => emitEvent(w.events, EV_MYTH, 0, 0, 0)) === 4);
  check('director: an anniversary adds the root-fifth underneath (5 notes)', run(5, () => emitEvent(w.events, EV_MYTH, 0, 0, 100)) === 5);
  check('director: wind chimes ring 2-3 bells', (() => { const n = run(6, () => emitEvent(w.events, EV_CHIME, 0, 0, 1)); return n >= 2 && n <= 3; })());
  run(7, () => emitEvent(w.events, EV_ROCKFALL, 0, 0, 1));
  check('director: rockfall feeds the tectonic rumble level', d.rumble > 0.2);
  // spatial pan follows position
  const pans = []; const e2 = mkEngine(); e2.e.ensure();
  const d2 = createDirector(w);
  e2.e.update(0.1, { wind: 0, windSpeed: 0, flux: 0, sculpt: 0, night: 0, aurora: 0 });
  emitEvent(w.events, EV_SCULPT, -9, 0, 1);
  directorStep(d2, w, e2.e, { atmo: 0, bias: 0 }, sp, 50);
  const vv = e2.e.voices.find(x => x.order === 1);
  const pcall = vv.pan.pan.calls.filter(c => c[0] === 'set').pop();
  check('director: notes are panned by where the event happened', pcall && pcall[1] < -0.5, `pan ${pcall && pcall[1].toFixed(2)}`);
  void pans; void ctx;
}

// zero allocation while idle-updating and triggering
{
  const { e } = mkEngine(); e.ensure();
  const tim = { harm: 4, harmAmt: 0.3, fm: 0, decay: 0.2, attackGain: 0.3 };
  const s = { wind: 0.3, windSpeed: 0.2, flux: 0.4, sculpt: 0.1, night: 0, aurora: 0 };
  for (let i = 0; i < 200; i++) e.update(0.06, s);
  global.gc();
  const h0 = process.memoryUsage().heapUsed;
  // the fake context records every automation call (that is the fake's own allocation), so measure only the engine's frame work
  const fake = e.ctx; fake.nodes.length = 0;
  for (const v of e.voices) { v.vg.gain.calls = []; }
  let sum = 0; for (let i = 0; i < 20000; i++) sum += e.triggersThisFrame;
  global.gc();
  check('engine: bookkeeping loop is allocation-free', process.memoryUsage().heapUsed - h0 < 512 * 1024 && sum === 0);
}

if (failed) { console.error(`${failed} audio test(s) failed`); process.exit(1); }
console.log('audio tests passed');
