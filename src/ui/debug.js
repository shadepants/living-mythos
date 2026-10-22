// Developer overlay: only ever created when the page is opened with ?debug=1 (spec 1.7).
export function createDebugOverlay() {
  const el = document.createElement('pre');
  el.id = 'debug';
  el.style.cssText = 'position:fixed;left:6px;top:6px;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,monospace;color:#cfe;background:rgba(0,0,0,0.55);border-radius:6px;pointer-events:none;z-index:9;white-space:pre';
  document.body.appendChild(el);
  let acc = 0, frames = 0, ms = 0, simMs = 0;
  return {
    sample(dt, sim) { frames++; ms += dt * 1000; simMs += sim; },
    update(dt, infoFn) {
      acc += dt;
      if (acc < 0.5) return;
      const info = infoFn();
      el.textContent = `frame ${(ms / frames).toFixed(1)} ms  sim ${(simMs / frames).toFixed(2)} ms  tier ${info.tier}\n` +
        `water ${info.water.toFixed(0)}  rock ${info.rock.toFixed(0)}  (drift ${info.drift.toFixed(3)}%)\n` +
        `villagers ${info.villagers}  structures ${info.structures}  myths ${info.myths}  particles ${info.particles}` +
        (info.discovery ? `\n${info.discovery}` : '');
      acc = 0; frames = 0; ms = 0; simMs = 0;
    },
  };
}
