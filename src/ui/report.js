// On-device test reporter: only active with ?report. Posts GPU info, frame stats, errors and a canvas snapshot back to the
// local server that served the page (tools/phone-server.mjs), so a real phone run can be inspected from the dev machine.
export function createReporter(renderer, canvas, info) {
  const errors = [];
  const origError = console.error;
  console.error = function (...a) { errors.push(a.map(String).join(' ').slice(0, 600)); origError.apply(console, a); };
  window.addEventListener('error', (e) => errors.push('window.onerror: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + (e.reason && e.reason.message)));
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : 'unknown';
  let acc = 0, frames = 0, ms = 0, simMs = 0, worst = 0, sent = 0, t = 0, shotDone = false;
  const post = (path, body) => { try { fetch(path, { method: 'POST', body }); } catch (e) { /* ignore */ } };
  return {
    tick(dt, sim, programs) {
      frames++; ms += dt * 1000; simMs += sim; if (dt * 1000 > worst) worst = dt * 1000;
      acc += dt; t += dt;
      if (acc >= 2) {
        post('/report', JSON.stringify({
          t: +t.toFixed(1), n: sent++, fps: +(frames / acc).toFixed(1), frameMs: +(ms / frames).toFixed(1), worstMs: +worst.toFixed(0), simMs: +(simMs / frames).toFixed(2),
          tier: info.tier(), programs, gpu, vendor, webgl2: true, dpr: window.devicePixelRatio, screen: [screen.width, screen.height], inner: [innerWidth, innerHeight],
          canvas: [canvas.width, canvas.height], touch: navigator.maxTouchPoints, ua: navigator.userAgent, lost: gl.isContextLost(), loss: info.loss(), flags: location.search, input: info.input ? info.input() : null, errors: errors.splice(0),
          villagers: info.villagers(), structures: info.structures(), particles: info.particles(), mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        }));
        acc = 0; frames = 0; ms = 0; simMs = 0; worst = 0;
      }
    },
    // call right after renderFrame() in the same task so the drawing buffer is still valid
    maybeShot(label, when) {
      if (shotDone || t < when) return false;
      shotDone = true;
      try { post('/shot?name=' + label, canvas.toDataURL('image/png')); } catch (e) { errors.push('shot failed: ' + e.message); }
      return true;
    },
    post,
  };
}
