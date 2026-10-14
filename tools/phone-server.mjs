// Serves dist/ on the LAN/localhost and collects /report and /shot posts from a real device running the app with ?report.
// Usage: node tools/phone-server.mjs [port] [outDir]   then open http://localhost:PORT/?report=phone on the device.
import http from 'node:http';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = +(process.argv[2] || 8765), out = process.argv[3] || '/tmp/phone';
mkdirSync(out, { recursive: true });
const log = join(out, 'reports.jsonl');
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      if (url.pathname === '/shot') {
        const name = (url.searchParams.get('name') || 'shot').replace(/[^\w-]/g, '');
        writeFileSync(join(out, name + '.png'), Buffer.from(body.split(',')[1] || '', 'base64'));
        console.log('shot saved', name);
      } else { appendFileSync(log, body + '\n'); const r = JSON.parse(body); console.log(`t=${r.t}s fps=${r.fps} frame=${r.frameMs}ms worst=${r.worstMs} sim=${r.simMs}ms tier=${r.tier} programs=${r.programs} gpu="${r.gpu}" errors=${r.errors.length}`); if (r.errors.length) console.log('  ERR', r.errors.join(' | ')); }
      res.writeHead(204); res.end();
    });
    return;
  }
  console.log('GET', req.url.slice(0, 90));
  res.setHeader('content-type', 'text/html');
  res.end(readFileSync(resolve(root, 'dist/index.html')));
}).listen(port, '0.0.0.0', () => console.log(`phone server on :${port}, writing to ${out}`));
