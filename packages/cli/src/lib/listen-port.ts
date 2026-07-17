import { createServer } from 'node:http';

const DEFAULT_HOST = '127.0.0.1';

export const isPortAvailable = (port: number, host = DEFAULT_HOST): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });

export const findAvailablePort = async (
  preferred: number,
  host = DEFAULT_HOST,
): Promise<number> => {
  if (preferred > 0 && (await isPortAvailable(preferred, host))) {
    return preferred;
  }
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : preferred;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
};
