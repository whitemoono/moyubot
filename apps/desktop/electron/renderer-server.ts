import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

/** A loopback web origin lets CSP frame-ancestors on the official viewer work.
 * Serves only packaged static assets; no API, credentials or filesystem bridge. */
export async function startRendererServer(root: string): Promise<{ url: string; close: () => void }> {
  const directory = path.resolve(root);
  const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
  const server = http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405).end(); return; }
    try {
      const address = server.address();
      if (!address || typeof address === 'string' || request.headers.host !== `127.0.0.1:${address.port}`) { response.writeHead(403).end(); return; }
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(directory, relative);
      if (file !== path.join(directory, 'index.html') && !file.startsWith(path.join(directory, 'assets') + path.sep)) { response.writeHead(404).end(); return; }
      const type = mime[path.extname(file)];
      if (!type || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      if (request.method === 'HEAD') response.end();
      else fs.createReadStream(file).pipe(response);
    } catch { response.writeHead(400).end(); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法加载应用界面');
  return { url: `http://127.0.0.1:${address.port}/`, close: () => { server.closeAllConnections(); server.close(); } };
}
