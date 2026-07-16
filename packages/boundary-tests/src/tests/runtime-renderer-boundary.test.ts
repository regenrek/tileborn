import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from '../lib/repo-root.js';
import { walkFiles } from '../lib/walk-files.js';

type ForbiddenPattern = {
  readonly name: string;
  readonly pattern: RegExp;
};

const RENDERER_ROOT = path.join(repoRoot, 'apps/desktop/src/renderer');

const FORBIDDEN_PATTERNS: readonly ForbiddenPattern[] = [
  {
    name: 'battle royale protocol symbol',
    pattern: /\b(?:BattleRoyaleProtocol|WelcomeSnapshot|DeltaSnapshot|PlayerInput)\b/,
  },
  {
    name: 'battle royale plugin id literal',
    pattern: /['"]@tileborne-plugins\/battle-royale['"]/,
  },
  {
    name: 'deep battle royale protocol import',
    pattern: /['"]@tileborne\/ipc-contracts\/[^'"]*\/protocols\/battle-royale(?:\.[jt]s)?['"]/,
  },
  {
    name: 'deep battle royale plugin import',
    pattern: /['"]@tileborne\/plugin-battle-royale\/src\/[^'"]+['"]/,
  },
];

const relativeRepoPath = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join('/');

describe('ADR-0014 desktop renderer boundary', () => {
  it('keeps battle royale wire symbols and deep imports out of the renderer shell', () => {
    const violations: string[] = [];
    const files = walkFiles({ rootDir: RENDERER_ROOT, extensions: ['.ts', '.tsx'] });

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex] ?? '';
        for (const forbidden of FORBIDDEN_PATTERNS) {
          if (forbidden.pattern.test(line)) {
            violations.push(`${forbidden.name}: ${relativeRepoPath(filePath)}:${lineIndex + 1}`);
          }
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
