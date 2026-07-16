import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const withTempHome = async <A>(run: (home: string) => Promise<A>): Promise<A> => {
  const previous = process.env['TILEBORNE_HOME'];
  const home = await mkdtemp(path.join(tmpdir(), 'tileborne-services-'));
  process.env['TILEBORNE_HOME'] = home;
  try {
    return await run(home);
  } finally {
    if (previous === undefined) {
      delete process.env['TILEBORNE_HOME'];
    } else {
      process.env['TILEBORNE_HOME'] = previous;
    }
    await rm(home, { recursive: true, force: true });
  }
};
