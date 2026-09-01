import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = Number(process.env.PLAYWRIGHT_PORT || 4173);
const mountPath = '/go-valuedex';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    ...headers
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname);
  } catch {
    send(response, 400, 'Bad request');
    return;
  }

  if (pathname === mountPath) {
    send(response, 308, '', { location: `${mountPath}/` });
    return;
  }
  if (!pathname.startsWith(`${mountPath}/`)) {
    send(response, 404, `This fixture is mounted only at ${mountPath}/`);
    return;
  }

  const relativePath = pathname.slice(mountPath.length + 1) || 'index.html';
  let filePath = resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    send(response, 403, 'Forbidden');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) filePath = resolve(filePath, 'index.html');
    const data = await readFile(filePath);
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': contentTypes[extname(filePath)] || 'application/octet-stream'
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    send(response, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});

server.listen(port, host, () => {
  process.stdout.write(`GO ValueDex fixture: http://${host}:${port}${mountPath}/\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
