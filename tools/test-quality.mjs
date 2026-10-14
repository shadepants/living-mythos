import { QUALITY, TIER_NAMES, pickInitialTier, createGovernor, governorSample } from '../src/gl/quality.js';
let failed = 0;
const check = (name, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? '  — ' + d : ''}`); if (!ok) failed++; };

check('tiers: low < mid < high on every axis', ['pr', 'taps', 'shadow', 'flora', 'substeps'].every(k => QUALITY.low[k] <= QUALITY.mid[k] && QUALITY.mid[k] <= QUALITY.high[k]));
check('tiers: spec numbers (1.0/1.5/2.0 px ratio, 6/12 taps, 1024/2048 shadows, 1800/3500 flora, 1/2/3 substeps)',
  QUALITY.low.pr === 1 && QUALITY.mid.pr === 1.5 && QUALITY.high.pr === 2 && QUALITY.low.taps === 6 && QUALITY.high.taps === 12 &&
  QUALITY.low.shadow === 1024 && QUALITY.mid.shadow === 2048 && QUALITY.low.flora === 1800 && QUALITY.high.flora === 3500 &&
  QUALITY.low.substeps === 1 && QUALITY.mid.substeps === 2 && QUALITY.high.substeps === 3);
check('boot: a phone starts on mid, a small phone on low, a desktop on high', pickInitialTier({ coarse: true, mem: 8 }) === 1 && pickInitialTier({ coarse: true, mem: 3 }) === 0 && pickInitialTier({ coarse: false, cores: 8 }) === 2);
check('boot: ?q= overrides detection', pickInitialTier({ override: 'low', coarse: false, cores: 8 }) === 0 && pickInitialTier({ override: 'bogus', coarse: false, cores: 8 }) === 2);

{
  const g = createGovernor(2);
  let drops = 0;
  for (let i = 0; i < 60 * 20; i++) if (governorSample(g, 1 / 60) >= 0) drops++;
  check('governor: a steady 60 fps never downgrades', drops === 0 && g.tier === 2);
}
{
  const g = createGovernor(2);
  let t = 0, first = -1, tiers = [];
  for (let i = 0; i < 25 * 60; i++) { t += 0.04; const r = governorSample(g, 0.04); if (r >= 0) { tiers.push(r); if (first < 0) first = t; } }
  check('governor: sustained 25 fps steps down one tier at a time after ~2 s', tiers[0] === 1 && first > 1.8 && first < 4, `first drop at ${first.toFixed(1)} s, then ${tiers}`);
  check('governor: keeps stepping down while slow, then stops at low', g.tier === 0 && tiers.join() === '1,0', `tiers ${tiers}`);
}
{
  const g = createGovernor(2);
  let drops = 0;
  for (let i = 0; i < 600; i++) { const dt = i % 100 === 0 ? 0.2 : 0.016; if (governorSample(g, dt) >= 0) drops++; }
  check('governor: an occasional hitch does not downgrade', drops === 0);
}
check('tier names', TIER_NAMES.join() === 'low,mid,high');
if (failed) { console.error(`${failed} quality test(s) failed`); process.exit(1); }
console.log('quality tests passed');
