import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { walkFiles } from '../lib/walk-files.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('walkFiles', () => {
  it('ignores transient tsup config modules while retaining repository source', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tileborne-walk-files-'));
    temporaryDirectories.push(rootDir);

    const sourcePath = path.join(rootDir, 'tsup.config.ts');
    fs.writeFileSync(sourcePath, 'export default {};\n');
    fs.writeFileSync(
      path.join(rootDir, 'tsup.config.bundled_kgpqf6piabp.mjs'),
      'export default {};\n',
    );

    expect(walkFiles({ rootDir, extensions: ['.ts', '.mjs'] })).toEqual([sourcePath]);
  });
});
