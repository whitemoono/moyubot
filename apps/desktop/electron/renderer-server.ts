import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

/** A loopback web origin lets CSP frame-ancestors on the official viewer work.
 * Serves only packaged static assets; no API, credentials or filesystem bridge. */
export async function startRendererServer(root: string): Promise<{ url: string; close: () => void }> {
  const directory = path.resolve(root);
  const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
  const server = http.createServer(async (request, response) => {
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
      // Electron's Windows ASAR stream reader can fail on nested paths.
      // Read the small packaged assets through the ASAR-aware file API.
      const bytes = request.method === 'HEAD' ? undefined : await fs.promises.readFile(file);
      response.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      response.end(bytes);
    } catch { response.writeHead(400).end(); }
  });
  server.unref();
  // Chromium 会拦截一批「不安全端口」（如 5060 SIP）：listen 成功但 loadURL 报 ERR_UNSAFE_PORT，界面全黑。
  // 之前 listen(0) 随机端口撞上 5060 就是这样。先试固定安全端口；随机端口撞上受限表就关权重掷。
  const RESTRICTED = new Set([5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);
  const listenOn = (port: number) => new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onUp); reject(error); };
    const onUp = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onUp);
    server.listen(port, '127.0.0.1');
  });
  const reopen = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => { const done = () => resolve(); server.once('close', done); server.close(done); });
    // 换一个新 server 语义：close 后原 http.Server 仍可再 listen。
  };
  for (let attempt = 0; attempt < 12; attempt++) {
    const fixed = [5173, 4173, 8288, 18080, 21320][attempt];
    try {
      await listenOn(fixed ?? 0);
      const address = server.address();
      if (address && typeof address !== 'string' && !RESTRICTED.has(address.port)) {
        return { url: `http://127.0.0.1:${address.port}/`, close: () => { server.closeAllConnections(); server.close(); } };
      }
      await reopen();
    } catch {
      // 端口被占：试下一个。
      continue;
    }
  }
  throw new Error('无法加载应用界面');
}
