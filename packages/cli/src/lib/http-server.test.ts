import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { serveStaticDirectory } from './http-server.js';

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) {
      await server.close();
    }
  }
});

describe('serveStaticDirectory', () => {
  it('serves index.html on port 0', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tileborne-http-'));
    await writeFile(path.join(dir, 'index.html'), '<html>ok</html>\n');
    const server = await serveStaticDirectory(dir, 0);
    servers.push(server);
    const response = await fetch(server.url);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('ok');
  });

  it('returns 404 for missing files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tileborne-http-miss-'));
    await writeFile(path.join(dir, 'index.html'), 'ok\n');
    const server = await serveStaticDirectory(dir, 0);
    servers.push(server);
    const response = await fetch(`${server.url}missing.txt`);
    expect(response.status).toBe(404);
  });
});
