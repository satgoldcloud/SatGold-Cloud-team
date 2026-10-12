import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(projectRoot, 'public');
const port = Number(process.env.PORT || 4173);
const types = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};

http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method not allowed');
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if (pathname.startsWith('/schools/')) {
    const slug = pathname.slice('/schools/'.length).replace(/\/$/, '');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) { res.writeHead(404); return res.end('School page not found'); }
    res.writeHead(302, { Location: `/school.html?slug=${encodeURIComponent(slug)}` });
    return res.end();
  }
  if (pathname === '/') pathname = '/index.html';
  let file = path.resolve(publicRoot, `.${pathname}`);
  if (file !== publicRoot && !file.startsWith(publicRoot + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  if (existsSync(file) && !path.extname(file)) file += '.html';
  if (!existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
  res.writeHead(200, {
    'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  console.log(`SatGold Cloud static preview: http://127.0.0.1:${port}`);
  console.log('This preview serves frontend files only. Use Vercel dev for /api routes and Supabase-backed workflows.');
});
