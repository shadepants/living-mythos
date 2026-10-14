// WebAudio synth: 16 persistent two-oscillator voices with LRU stealing, ping-pong delay, procedural convolution reverb
// and a continuous noise bus (wind / rapids / rumble). Nothing is created after boot except scheduled automation.

export const VOICES = 16;
export const IR_SECONDS = 3.5;

export function clampFilterFreq(f) { return f < 40 ? 40 : f > 12000 ? 12000 : f; }
export function clampFilterQ(q) { return q < 0.5 ? 0.5 : q > 8 ? 8 : q; }

// Stereo velvet-noise tail with an octave-up shimmer layer (spec 7).
export function fillImpulseResponse(left, right, sampleRate) {
  const len = left.length;
  let s = 0x1234567;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const density = 2400;                       // impulses per second
  const gap = sampleRate / density;
  for (let ch = 0; ch < 2; ch++) {
    const d = ch === 0 ? left : right;
    for (let i = 0; i < len; i += gap | 0 || 1) {
      const j = Math.min(len - 1, Math.floor(i + rnd() * gap));
      const t = j / sampleRate;
      const env = Math.exp(-t * (6.9 / 3.2)) * (t < 0.01 ? t / 0.01 : 1);     // ~60 dB over 3.2 s with a soft onset
      d[j] += (rnd() < 0.5 ? -1 : 1) * env;
    }
    // shimmer: the same tail read at double speed (one octave up), quieter and shorter
    const half = len >> 1;
    for (let i = 0; i < half; i++) d[i] += 0.32 * d[i * 2] * Math.exp(-(i / sampleRate) * 1.4);
    // gentle one-pole low-pass so the tail is velvet, not hiss
    let y = 0;
    for (let i = 0; i < len; i++) { y += (d[i] - y) * 0.55; d[i] = y * 0.35; }
  }
}

function noiseBuffer(ctx, seconds) {
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  let s = 0xBEEF;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1; };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;       // Paul Kellet pink noise
    for (let i = 0; i < len; i++) {
      const w = rnd();
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
      d[i] = pink * 0.8 + w * 0.2 * 0.5;
    }
  }
  return buf;
}

export function createAudioEngine(makeCtx) {
  const E = {
    ctx: null, ready: false, muted: false, voices: [], order: 0, started: 0,
    nodes: null, tickClock: 0, lastTrigger: 0, triggersThisFrame: 0,
  };

  function build() {
    const ctx = makeCtx();
    E.ctx = ctx;
    const out = ctx.createGain(); out.gain.value = 0.8; out.connect(ctx.destination);

    const master = ctx.createBiquadFilter(); master.type = 'lowpass'; master.frequency.value = 9000; master.Q.value = 0.7;
    const dry = ctx.createGain(); dry.gain.value = 0.85;
    master.connect(dry); dry.connect(out);

    // ping-pong delay: L -> damping low-pass -> R -> feedback -> L, with each line panned hard to its side
    const delaySend = ctx.createGain(); delaySend.gain.value = 0.22; master.connect(delaySend);
    const dL = ctx.createDelay(1.0), dR = ctx.createDelay(1.0);
    dL.delayTime.value = 0.28; dR.delayTime.value = 0.37;
    const fbR = ctx.createGain(); fbR.gain.value = 0.38;
    const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 3200;
    const pL = ctx.createStereoPanner(), pR = ctx.createStereoPanner(); pL.pan.value = -1; pR.pan.value = 1;
    delaySend.connect(dL); dL.connect(damp); damp.connect(dR); dR.connect(fbR); fbR.connect(dL);
    dL.connect(pL); dR.connect(pR); pL.connect(out); pR.connect(out);

    // convolution reverb with a procedurally synthesised 3.5 s stereo impulse response
    const conv = ctx.createConvolver();
    const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * IR_SECONDS), ctx.sampleRate);
    fillImpulseResponse(ir.getChannelData(0), ir.getChannelData(1), ctx.sampleRate);
    conv.buffer = ir;
    const revSend = ctx.createGain(); revSend.gain.value = 0.34;
    const revOut = ctx.createGain(); revOut.gain.value = 0.9;
    master.connect(revSend); revSend.connect(conv); conv.connect(revOut); revOut.connect(out);

    // 16 persistent voices
    for (let i = 0; i < VOICES; i++) {
      const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 220;
      const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 440;
      const vg = ctx.createGain(); vg.gain.value = 0;
      const hg = ctx.createGain(); hg.gain.value = 0;
      const fm = ctx.createGain(); fm.gain.value = 0;
      const pan = ctx.createStereoPanner(); pan.pan.value = 0;
      o1.connect(vg); o2.connect(hg); hg.connect(vg); o2.connect(fm); fm.connect(o1.frequency);
      vg.connect(pan); pan.connect(master);
      o1.start(); o2.start();
      E.voices.push({ o1, o2, vg, hg, fm, pan, order: 0, busyUntil: 0 });
    }

    // continuous environment bus: one looping pink+white noise buffer through three parallel filters
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 4); src.loop = true;
    const envBus = ctx.createGain(); envBus.gain.value = 1;
    const mk = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; const g = ctx.createGain(); g.gain.value = 0; src.connect(b); b.connect(g); g.connect(envBus); return { f: b, g }; };
    const wind = mk('bandpass', 700, 1.2), river = mk('bandpass', 500, 1.5), rumble = mk('lowpass', 90, 0.8);
    envBus.connect(out);
    const envRev = ctx.createGain(); envRev.gain.value = 0.12; envBus.connect(envRev); envRev.connect(conv);
    src.start();

    E.nodes = { out, master, dry, delaySend, revSend, wind, river, rumble, envBus };
    E.ready = true;
  }

  // Create on the first user gesture only (autoplay policy), then resume.
  E.ensure = function ensure() {
    if (!E.ready) { try { build(); } catch (e) { E.ready = false; E.ctx = null; return false; } }
    if (E.ctx && E.ctx.state === 'suspended') E.ctx.resume();
    return E.ready;
  };

  function pickVoice(t) {
    let best = -1, bo = Infinity;
    for (let i = 0; i < E.voices.length; i++) { if (E.voices[i].busyUntil <= t) { if (E.voices[i].order < bo) { bo = E.voices[i].order; best = i; } } }
    let stolen = false;
    if (best < 0) {                                                     // everyone busy: steal the least recently triggered
      stolen = true; bo = Infinity;
      for (let i = 0; i < E.voices.length; i++) if (E.voices[i].order < bo) { bo = E.voices[i].order; best = i; }
    }
    E.pickedStolen = stolen;
    return E.voices[best];
  }

  // trigger a note. p: {vel, tim:{harm,harmAmt,fm,decay,attackGain}, pan, delay}
  E.trigger = function trigger(freq, vel, tim, pan, delay) {
    if (!E.ready || E.muted) return false;
    if (E.triggersThisFrame >= 8) return false;
    E.triggersThisFrame++;
    const ctx = E.ctx;
    const t = ctx.currentTime + (delay || 0);
    const v = pickVoice(t);
    const stolen = E.pickedStolen;
    v.order = ++E.order;
    const t0 = stolen ? t + 0.012 : t;                                  // stolen voices fade out first so the steal is click-free
    if (stolen) { v.vg.gain.cancelScheduledValues(t); v.vg.gain.setTargetAtTime(0, t, 0.002); }
    else v.vg.gain.cancelScheduledValues(t);
    v.o1.frequency.cancelScheduledValues(t0); v.o1.frequency.setValueAtTime(freq, t0);
    v.o2.frequency.cancelScheduledValues(t0); v.o2.frequency.setValueAtTime(freq * tim.harm, t0);
    v.fm.gain.cancelScheduledValues(t0); v.fm.gain.setValueAtTime(tim.fm * vel, t0); v.fm.gain.setTargetAtTime(0, t0, tim.decay * 0.5);
    v.hg.gain.cancelScheduledValues(t0); v.hg.gain.setValueAtTime(tim.harmAmt * vel, t0); v.hg.gain.setTargetAtTime(0, t0, tim.decay * 0.35);
    v.pan.pan.cancelScheduledValues(t0); v.pan.pan.setValueAtTime(pan < -1 ? -1 : pan > 1 ? 1 : pan, t0);
    const peak = tim.attackGain * vel;
    if (!stolen) v.vg.gain.setValueAtTime(0, t0);                       // fresh voices start silent; stolen ones decayed to ~0
    v.vg.gain.linearRampToValueAtTime(peak, t0 + 0.005);                // 5 ms linear attack
    v.vg.gain.setTargetAtTime(0, t0 + 0.005, tim.decay);                // exponential decay
    v.busyUntil = t0 + 0.005 + tim.decay * 5;
    return true;
  };

  function setFilter(slot, freq, q, gain, now) {
    slot.f.frequency.setTargetAtTime(clampFilterFreq(freq), now, 0.04);
    slot.f.Q.setTargetAtTime(clampFilterQ(q), now, 0.04);
    slot.g.gain.setTargetAtTime(gain < 0 ? 0 : gain > 1 ? 1 : gain, now, 0.04);
  }

  // s: {wind 0..1, windSpeed 0..1, flux 0..1, sculpt 0..1, night 0..1, aurora 0..1}
  E.update = function update(dt, s) {
    E.triggersThisFrame = 0;
    if (!E.ready) return;
    E.tickClock += dt;
    if (E.tickClock < 0.05) return;
    E.tickClock = 0;
    const now = E.ctx.currentTime, n = E.nodes;
    setFilter(n.wind, 350 + 1700 * s.wind + 900 * s.windSpeed, 0.9 + 2.5 * s.wind, 0.015 + 0.09 * s.wind + 0.05 * s.windSpeed, now);
    setFilter(n.river, 260 + 1900 * s.flux, 1.2 + 2 * s.flux, 0.01 + 0.16 * s.flux, now);
    setFilter(n.rumble, 55 + 260 * s.sculpt, 0.7 + 1.5 * s.sculpt, 0.02 + 0.5 * s.sculpt, now);
    n.master.frequency.setTargetAtTime(clampFilterFreq(9000 - 3500 * s.aurora), now, 0.2);
    n.revSend.gain.setTargetAtTime(0.3 + 0.2 * s.night, now, 0.3);
    n.out.gain.setTargetAtTime(E.muted ? 0 : 0.8, now, 0.05);
  };

  E.setMuted = function setMuted(m) {
    E.muted = !!m;
    if (E.ready) E.nodes.out.gain.setTargetAtTime(E.muted ? 0 : 0.8, E.ctx.currentTime, 0.05);
  };
  E.suspend = function suspend() { if (E.ctx && E.ctx.state === 'running') E.ctx.suspend(); };
  E.resume = function resume() { if (E.ctx && E.ctx.state === 'suspended') E.ctx.resume(); };
  return E;
}
