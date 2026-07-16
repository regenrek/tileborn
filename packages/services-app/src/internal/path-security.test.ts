import path from 'node:path';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { verifiedChildPath } from './path-security.js';

describe('verifiedChildPath', () => {
  const root = path.resolve('/tmp/tileborne-project');

  it('rejects traversal, absolute, and NUL-byte paths', async () => {
    for (const candidate of ['../outside.tmj', '/etc/passwd', 'bad\0path.tmj']) {
      const error = await Effect.runPromise(verifiedChildPath(root, candidate)).catch(
        (cause) => cause,
      );
      expect(error.message).toMatch(/Path traversal|outside|NUL/i);
    }
  });
});
