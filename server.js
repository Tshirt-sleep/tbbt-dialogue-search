import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mp4': 'video/mp4' };
const allowedPages = new Set(['/', '/index.html', '/src/app.js', '/src/core.js', '/src/style.css', '/data/dialogues.json', '/data/episodes.json']);

http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!allowedPages.has(pathname) && !/^\/media\/[A-Za-z0-9_-]+\.mp4$/.test(pathname)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('文件不存在');
      return;
    }
    let file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    let stat;
    try { stat = await fs.stat(file); }
    catch (error) {
      const fallback = { '/data/dialogues.json': 'dialogues.example.json', '/data/episodes.json': 'episodes.example.json' }[pathname];
      if (!fallback || error.code !== 'ENOENT') throw error;
      file = path.join(root, 'data', fallback);
      stat = await fs.stat(file);
    }
    if (!stat.isFile()) throw new Error('Not a file');
    const type = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = request.headers.range;
    if (range && type === 'video/mp4') {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
      response.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': type === 'video/mp4' ? 'bytes' : 'none' });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('文件不存在');
  }
}).listen(port, '127.0.0.1', () => console.log(`打开 http://localhost:${port}`));
