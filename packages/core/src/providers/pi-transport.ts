import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { providerFetch } from './transport';
import type { ProviderConfig } from '../types';

/** pi's Google SDK cannot inject fetch. Route this request through a private
 * loopback endpoint so Electron's proxy/direct transport remains authoritative. */
export async function googleTransport(config: ProviderConfig, onStatus: (status: number) => void): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const prefix = `/${randomBytes(24).toString('hex')}`;
  const server = http.createServer(async (request, response) => {
    if (!request.url?.startsWith(`${prefix}/`) || request.method !== 'POST') { response.writeHead(404).end(); return; }
    const abort = new AbortController();
    response.on('close', () => abort.abort());
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (!['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding'].includes(name) && typeof value === 'string') headers[name] = value;
      }
      const upstream = await providerFetch(config, config.baseUrl.replace(/\/+$/, '') + request.url.slice(prefix.length), {
        method: 'POST', headers, body: Buffer.concat(chunks), signal: abort.signal,
      });
      onStatus(upstream.status);
      const outgoing: Record<string, string> = {};
      for (const name of ['content-type', 'retry-after']) { const value = upstream.headers.get(name); if (value) outgoing[name] = value; }
      response.writeHead(upstream.status, outgoing);
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body as any), response);
      else response.end();
    } catch { if (!response.headersSent) response.writeHead(502); response.end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address() as { port: number };
  return { baseUrl: `http://127.0.0.1:${address.port}${prefix}`, close: async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
