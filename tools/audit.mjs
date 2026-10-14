// Static checks on the shipped artifact and sources (spec M10, run from M0 so regressions show early).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8');

function walk(d) {
  return readdirSync(d).flatMap(n => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const srcText = walk(resolve(root, 'src')).map(p => readFileSync(p, 'utf8')).join('\n');

const banned = [
  [/THREE\.Clock|new Clock\(/, 'THREE.Clock is banned (use Timer)'],
  [/\.min\.js/, '.min.js URLs are banned'],
  [/PCFSoftShadowMap/, 'PCFSoftShadowMap is banned'],
  [/Raycaster/, 'Raycaster is banned (analytical raymarch only)'],
  [/\bTODO\b|\bFIXME\b/, 'TODO/FIXME left in source'],
  [/addons\/misc\/Timer\.js/, 'addons Timer does not exist in r186'],
];
for (const [re, msg] of banned) if (re.test(srcText)) fails.push(msg);

if ((html.match(/toneMapping\s*=\s*THREE\.NoToneMapping/g) || []).length !== 1) fails.push('renderer must set NoToneMapping exactly once');
if (/<script[^>]+src=/.test(html)) fails.push('external <script src> found; must be a single file');

// Syntax-check the inlined module.
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) fails.push('no inline module script');
else {
  const dir = mkdtempSync(join(tmpdir(), 'mythos-'));
  const f = join(dir, 'bundle.mjs');
  writeFileSync(f, m[1]);
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fails.push('bundle syntax error:\n' + r.stderr);
}

if (fails.length) { console.error('AUDIT FAILED:\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('audit ok');
