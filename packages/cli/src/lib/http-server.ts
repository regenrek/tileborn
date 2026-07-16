import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { rejectPathTraversal, rejectSymlinkEscape } from '@tileborne/asset-pipeline';

export interface StaticServerHandle {
  readonly port: number;
  readonly url: string;
  readonly close: () => Promise<void>;
}

export const serveStaticDirectory = async (
  root: string,
  requestedPort: number,
): Promise<StaticServerHandle> => {
  const resolveFile = async (urlPath: string): Promise<string | undefined> => {
    const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
    rejectPathTraversal(root, relative);
    const resolved = await rejectSymlinkEscape(root, relative).catch(() => undefined);
    if (!resolved) {
      return undefined;
    }
    return resolved;
  };

  const server = await new Promise<Server>((resolve, reject) => {
    const created = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const filePath = await resolveFile(url.pathname);
        if (!filePath) {
          response.statusCode = 404;
          response.end('not found');
          return;
        }
        const body = await readFile(filePath);
        const ext = path.extname(filePath);
        const contentType =
          ext === '.html'
            ? 'text/html; charset=utf-8'
            : ext === '.json'
              ? 'application/json; charset=utf-8'
              : 'application/octet-stream';
        response.statusCode = 200;
        response.setHeader('content-type', contentType);
        response.end(body);
      } catch {
        response.statusCode = 500;
        response.end('error');
      }
    });
    const listen = (port: number) => {
      created.once('error', reject);
      created.listen(port, '127.0.0.1', () => {
        created.off('error', reject);
        resolve(created);
      });
    };
    if (requestedPort === 0) {
      listen(0);
      return;
    }
    listen(requestedPort);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;
  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};
