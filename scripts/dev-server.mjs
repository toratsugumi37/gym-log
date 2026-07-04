// Vercel 서버리스 핸들러를 로컬에서 실행하는 개발 서버.
// 실행: node --env-file=.env scripts/dev-server.mjs  (npm run dev)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, parse as parseUrl } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const handlers = {
  '/api/auth': (await import('../api/auth.js')).default,
  '/api/sets': (await import('../api/sets.js')).default,
  '/api/body': (await import('../api/body.js')).default,
};

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  const { pathname, query } = parseUrl(req.url, true);

  if (handlers[pathname]) {
    req.query = query;
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    }
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(obj));
    };
    try {
      await handlers[pathname](req, res);
    } catch (err) {
      console.error(err);
      if (!res.writableEnded) res.status(500).json({ ok: false, error: 'dev server error' });
    }
    return;
  }

  const filePath = pathname === '/' ? '/index.html' : pathname;
  try {
    const body = await readFile(join(root, filePath));
    res.writeHead(200, { 'Content-Type': mime[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(8730, () => console.log('dev server: http://localhost:8730'));
