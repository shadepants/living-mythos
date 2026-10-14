// Dependency-free bundler: inlines local ES modules into one self-contained dist/index.html.
// Rules for src modules (checked here): local imports use './x.js' paths, top-level names are
// unique across modules (flat scope after bundling), no default exports, no side-effect-only cycles.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'src');
const order = [];
const seen = new Set();
const external = new Set();
const bodies = new Map();
const names = new Map(); // top-level name -> file

const importRe = /^import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm;
const sideImportRe = /^import\s+['"]([^'"]+)['"];?[ \t]*$/gm;

function visit(file, stack = []) {
  if (seen.has(file)) return;
  if (stack.includes(file)) throw new Error('import cycle: ' + [...stack, file].map(f => relative(src, f)).join(' -> '));
  let code = readFileSync(file, 'utf8');
  const deps = [];
  code = code.replace(importRe, (m, clause, spec) => {
    if (spec.startsWith('.')) {
      if (/\bas\b|\*/.test(clause)) throw new Error(relative(src, file) + ': aliased/namespace local imports are not supported: ' + m.trim());
      deps.push(resolve(dirname(file), spec)); return '';
    }
    external.add(m.trim().replace(/;?$/, ';'));
    return '';
  });
  code = code.replace(sideImportRe, (m, spec) => {
    if (spec.startsWith('.')) { deps.push(resolve(dirname(file), spec)); return ''; }
    external.add(m.trim().replace(/;?$/, ';'));
    return '';
  });
  if (/export\s+default/.test(code)) throw new Error(relative(src, file) + ': default exports are not supported');
  code = code.replace(/^export\s+(?=(async\s+)?(function|class|const|let|var)\b)/gm, '');
  if (/^export\s/m.test(code)) throw new Error(relative(src, file) + ': unsupported export form (use "export const/function/class")');
  for (const d of deps) visit(d, [...stack, file]);
  seen.add(file);
  const declRe = /^(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = declRe.exec(code))) {
    const prior = names.get(m[1]);
    if (prior && prior !== file) throw new Error(`duplicate top-level name "${m[1]}" in ${relative(src, file)} and ${relative(src, prior)}`);
    names.set(m[1], file);
  }
  bodies.set(file, code.trim());
  order.push(file);
}

visit(resolve(src, 'main.js'));

const bundle = [
  [...external].join('\n'),
  ...order.map(f => `// ---- ${relative(src, f)} ----\n${bodies.get(f)}`),
].join('\n\n');

const html = readFileSync(resolve(src, 'index.html'), 'utf8')
  .replace('/*STYLES*/', () => readFileSync(resolve(src, 'style.css'), 'utf8').trim())
  .replace('/*BUNDLE*/', () => bundle);

mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/index.html'), html);
console.log(`built dist/index.html (${(html.length / 1024).toFixed(1)} KB, ${order.length} modules)`);
