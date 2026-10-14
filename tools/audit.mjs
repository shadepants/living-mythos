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

// Spec contract checks on the shipped file (spec 1, 2, 5, 6.2).
const must = (re, msg) => { if (!re.test(html)) fails.push('missing: ' + msg); };
must(/"three": "https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.186\.0\/build\/three\.module\.js"/, 'three@0.186.0 import map entry');
must(/"three\/addons\/": "https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.186\.0\/examples\/jsm\/"/, 'three/addons/ import map entry');
must(/new THREE\.Timer\(\)/, 'THREE.Timer');
must(/timer\.connect\(document\)/, 'timer.connect(document)');
must(/renderer\.setAnimationLoop\(\(time\) =>/, 'setAnimationLoop((time) => ...)');
must(/Math\.min\(rawDt, 0\.05\)/, 'dt clamp 0.05');
must(/antialias: false, powerPreference: 'high-performance'/, 'renderer options');
must(/getExtension\('OES_texture_float_linear'\)/, 'OES_texture_float_linear');
must(/shadowMap\.type = THREE\.PCFShadowMap/, 'PCFShadowMap');
must(/new THREE\.DataTexture\(buf, GRID_W, GRID_H, THREE\.RGBAFormat, THREE\.FloatType\)/, 'float DataTexture 128x128');
must(/backdrop-filter: blur\(16px\)/, 'dock backdrop-filter blur(16px)');
must(/THREE\.HalfFloatType/, 'half-float render target');
must(/new THREE\.DepthTexture\(width, height, THREE\.UnsignedIntType\)/, 'depth texture');
must(/uSimTexA/, 'uSimTexA'); must(/uSimTexB/, 'uSimTexB'); must(/uAtmo/, 'uAtmo');
if ((html.match(/acesFilm\(/g) || []).length !== 2) fails.push('ACES must be defined once and called once (found ' + (html.match(/acesFilm\(/g) || []).length + ' occurrences)');
if ((html.match(/srgbEncode\(/g) || []).length !== 2) fails.push('sRGB encode must be defined once and called once');
const pools = (html.match(/new THREE\.InstancedMesh\(/g) || []).length;
if (pools !== 5) fails.push(`expected 4 entity pools + the raincloud puff cluster (5 InstancedMesh), found ${pools}`);
const aState = (html.match(/setAttribute\('aInstanceState'/g) || []).length;
if (aState !== 4) fails.push(`expected aInstanceState on exactly 4 pools, found ${aState}`);
const budgets = [[/FLORA_MAX = 3500/, 'flora 3500'], [/structureCap: 600/, 'structures 600'], [/villagers: 120/, 'villagers 120'], [/PARTICLE_CAP = 1000/, 'particles 1000']];
for (const [re, n] of budgets) if (!re.test(html)) fails.push('pool budget missing: ' + n);
if (/<img|\.png|\.jpg|\.woff|\.mp3|\.wav|\.ogg|url\(['"]?http/.test(html.replace(/'image\/png'/g, '').replace(/\.png`/g, ''))) fails.push('external asset reference found');
if (/console\.log|debugger/.test(srcText)) fails.push('console.log/debugger left in source');
if (!/getElementById\('debug'\)|createDebugOverlay\(\) : null/.test(srcText) && !/DEBUG \? createDebugOverlay/.test(srcText)) fails.push('debug overlay must be gated behind the DEBUG flag');

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
