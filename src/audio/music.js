// Scale quantizer and timbre presets. Pentatonic / Dorian modes follow the atmosphere; the root leans with regional culture.
export const SCALES = [
  { name: 'golden pentatonic', root: 62, steps: [0, 2, 4, 7, 9] },            // D major pentatonic
  { name: 'aurora dorian', root: 57, steps: [0, 2, 3, 5, 7, 9, 10] },         // A Dorian
  { name: 'monsoon minor pentatonic', root: 52, steps: [0, 3, 5, 7, 10] },    // E minor pentatonic
];

export function scaleFor(atmo) { return atmo < 0.25 ? SCALES[0] : atmo < 0.75 ? SCALES[1] : SCALES[2]; }
export function rootShift(bias) { return Math.round((bias < -1 ? -1 : bias > 1 ? 1 : bias) * 2); }   // -2..+2 semitones

export function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// degree 0 = root, counting up through the scale and across octaves (negative degrees go below the root)
export function degreeMidi(scale, degree, bias) {
  const n = scale.steps.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return scale.root + rootShift(bias) + scale.steps[idx] + 12 * oct;
}
export function degreeFreq(scale, degree, bias) { return midiToFreq(degreeMidi(scale, degree, bias)); }
export function semiFreq(scale, semis, bias) { return midiToFreq(scale.root + rootShift(bias) + semis); }

// True when a midi note belongs to the scale (any octave) at the given root shift.
export function inScale(scale, midi, bias) {
  const rel = (((midi - scale.root - rootShift(bias)) % 12) + 12) % 12;
  return scale.steps.indexOf(rel) >= 0;
}

export const TIMBRE = {
  marimba: { harm: 4.0, harmAmt: 0.34, fm: 0, decay: 0.20, attackGain: 0.34 },
  kalimba: { harm: 5.4, harmAmt: 0.24, fm: 0, decay: 0.34, attackGain: 0.26 },
  bell: { harm: 3.5, harmAmt: 0.38, fm: 85, decay: 0.85, attackGain: 0.22 },
  warm: { harm: 2.0, harmAmt: 0.10, fm: 0, decay: 0.65, attackGain: 0.20 },
  thump: { harm: 1.0, harmAmt: 0.0, fm: 0, decay: 0.22, attackGain: 0.40 },
};
