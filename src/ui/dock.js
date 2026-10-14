// Glassmorphic bottom dock: 4 tools, 3-state atmosphere selector and a Drift toggle. Pure DOM; no per-frame work.
const ICONS = {
  sculpt: '<svg viewBox="0 0 24 24"><path d="M3 19l6-10 4 6 3-4 5 8z"/><path d="M12 3v4M10 5l2-2 2 2"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M7 16a4 4 0 010-8 5 5 0 019.5-1A3.5 3.5 0 0117 16z"/><path d="M9 19l-1 2M13 19l-1 2M17 19l-1 2"/></svg>',
  monolith: '<svg viewBox="0 0 24 24"><path d="M9 21L10 4l2-2 2 2 1 17z"/><path d="M12 8v6"/></svg>',
  breeze: '<svg viewBox="0 0 24 24"><path d="M3 9h10a3 3 0 10-3-3"/><path d="M3 14h15a3 3 0 11-3 3"/><path d="M3 19h6"/></svg>',
  golden: '<svg viewBox="0 0 24 24"><path d="M5 17a7 7 0 0114 0"/><path d="M2 20h20M12 4v3M5 8l2 2M19 8l-2 2"/></svg>',
  aurora: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/><path d="M17 4v3M15.5 5.5h3"/></svg>',
  monsoon: '<svg viewBox="0 0 24 24"><path d="M7 14a4 4 0 010-8 5 5 0 019.5-1A3.5 3.5 0 0117 14z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/></svg>',
  drift: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0114-5l2 2"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 01-14 5l-2-2"/><path d="M4 20v-5h5"/></svg>',
};
export const TOOL_NAMES = ['Sculpt', 'Cloud', 'Monolith', 'Breeze'];
const TOOL_ICONS = ['sculpt', 'cloud', 'monolith', 'breeze'];
const TOOL_LABELS = ['Sculpt Land', 'Summon Raincloud', 'Drop Harmonic Monolith', 'Shepherd Breeze'];
const ATMO = [['golden', 'Golden Hour', 0], ['aurora', 'Aurora', 0.5], ['monsoon', 'Monsoon', 1]];
export const TOOL_HINTS = [
  'Hold to raise land · right-click, Shift or long-press to carve',
  'Hold to let it rain · tap for a short shower',
  'Tap to stand a monolith (up to 8; the oldest is recycled)',
  'Move over the island to part the foliage · tap for wind chimes',
];

export function createDock(root, handlers) {
  const dock = document.createElement('div');
  dock.id = 'dock';
  dock.setAttribute('role', 'toolbar');
  dock.setAttribute('aria-label', 'Tools and atmosphere');
  const hint = document.createElement('div');
  hint.id = 'hint';
  hint.setAttribute('aria-live', 'polite');

  const toolBtns = [], atmoBtns = [];
  const mk = (icon, text, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label || text);
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = ICONS[icon] + '<span>' + text + '</span>';
    return b;
  };
  for (let i = 0; i < 4; i++) {
    const b = mk(TOOL_ICONS[i], TOOL_NAMES[i], TOOL_LABELS[i]);
    b.addEventListener('click', () => handlers.onTool(i));
    dock.appendChild(b); toolBtns.push(b);
  }
  const sep = document.createElement('div'); sep.className = 'sep'; dock.appendChild(sep);
  for (const [icon, text, v] of ATMO) {
    const b = mk(icon, text === 'Golden Hour' ? 'Golden' : text);
    b.setAttribute('aria-label', text);
    b.addEventListener('click', () => handlers.onAtmo(v));
    dock.appendChild(b); atmoBtns.push(b);
  }
  const drift = mk('drift', 'Drift', 'Let the weather drift on its own');
  drift.addEventListener('click', () => handlers.onDrift());
  dock.appendChild(drift);
  // the dock never lets pointer events reach the canvas controller
  for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'wheel']) dock.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  root.appendChild(hint);
  root.appendChild(dock);

  let hintTimer = 0;
  return {
    setTool(i) { toolBtns.forEach((b, k) => b.setAttribute('aria-pressed', k === i ? 'true' : 'false')); },
    setAtmo(pinnedIndex, drifting) {
      atmoBtns.forEach((b, k) => b.setAttribute('aria-pressed', k === pinnedIndex ? 'true' : 'false'));
      drift.setAttribute('aria-pressed', drifting ? 'true' : 'false');
    },
    showHint(text, ms) {
      hint.textContent = text;
      hint.classList.add('show');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hint.classList.remove('show'), ms || 4200);
    },
  };
}

// Small glass sound toggle in the top-right corner.
export function createMuteButton(root, onToggle) {
  const b = document.createElement('button');
  b.id = 'mute';
  b.type = 'button';
  b.setAttribute('aria-label', 'Sound');
  b.setAttribute('aria-pressed', 'false');
  const on = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/></svg>';
  const off = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
  b.innerHTML = on;
  b.addEventListener('click', () => { const muted = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', muted ? 'true' : 'false'); b.innerHTML = muted ? off : on; onToggle(muted); });
  for (const ev of ['pointerdown', 'pointerup', 'pointermove']) b.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  root.appendChild(b);
  return {
    set(muted) { b.setAttribute('aria-pressed', muted ? 'true' : 'false'); b.innerHTML = muted ? off : on; },
  };
}

// Camera button under the sound toggle: photo mode.
export function createPhotoButton(root, onClick) {
  const b = document.createElement('button');
  b.id = 'photo';
  b.type = 'button';
  b.setAttribute('aria-label', 'Photo mode');
  b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  b.addEventListener('click', onClick);
  for (const ev of ['pointerdown', 'pointerup', 'pointermove']) b.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  root.appendChild(b);
  return b;
}
