/* 零依赖静态服务器：node serve.mjs [port] */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.argv[2]) || 8787;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

http
  .createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end("403");
    }
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": mime[extname(file).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("404");
    }
  })
  .listen(port, "0.0.0.0", () => {
    console.log(`Local : http://localhost:${port}`);
    for (const [name, nics] of Object.entries(os.networkInterfaces())) {
      for (const nic of nics) {
        if (nic.family === "IPv4" && !nic.internal) {
          console.log(`LAN   : http://${nic.address}:${port}   (${name})`);
        }
      }
    }
  });
