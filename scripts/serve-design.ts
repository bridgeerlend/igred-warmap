/**
 * Minimal static server for local review. Serves the repository root so the map can reach
 * both /site/ and /data/ the way it will in production.
 * Development only — nothing in the published pipeline depends on it.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../src/core/util/paths.js';

const root = repoRoot;
const port = Number(process.env.PORT ?? 4321);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

createServer(async (request, response) => {
  const requested = decodeURIComponent((request.url ?? '/').split('?')[0] as string);
  const relative = requested === '/' ? 'site/index.html' : requested.replace(/^\/+/, '');
  let filePath = path.join(root, relative);
  // Directories serve their index.html, as GitHub Pages and Netlify do.
  if (relative === '' || relative.endsWith('/')) filePath = path.join(filePath, 'index.html');

  // Never serve outside the repository.
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      response.writeHead(301, { location: `${requested}/` }).end();
      return;
    }
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': TYPES[path.extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<h1>404</h1>');
  }
}).listen(port, () => console.log(`Map: http://localhost:${port}/site/  ·  Design explorations: http://localhost:${port}/design/`));
