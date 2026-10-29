const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.md':'text/plain; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.wav':'audio/wav','.mp4':'video/mp4','.srt':'text/plain; charset=utf-8'};
const server = http.createServer((req, res) => {
  let file;
  try { file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); } catch { res.writeHead(400).end(); return; }
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('Not found'); return; }
  const stat = fs.statSync(file);
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  if (range) {
    const start = +range[1], end = Math.min(range[2] ? +range[2] : stat.size - 1, stat.size - 1);
    if (start > end) { res.writeHead(416).end(); return; }
    res.writeHead(206, {'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Content-Length':end-start+1});
    fs.createReadStream(file,{start,end}).pipe(res);
  } else {res.writeHead(200,{'Content-Length':stat.size});fs.createReadStream(file).pipe(res);}
});
if (require.main === module) server.listen(4318, '127.0.0.1', () => console.log('http://127.0.0.1:4318/media/moyubot-film/'));
module.exports = server;
