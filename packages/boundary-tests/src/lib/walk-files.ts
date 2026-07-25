import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.vite', 'out']);
const TRANSIENT_BUILD_FILE_PATTERNS = [/^tsup\.config\.bundled_[a-z0-9]+\.mjs$/i] as const;

export type WalkOptions = {
  readonly rootDir: string;
  readonly extensions?: readonly string[];
  readonly skipDirNames?: ReadonlySet<string>;
};

export function walkFiles(options: WalkOptions): string[] {
  const extensions = options.extensions ?? ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css'];
  const skipDirNames = options.skipDirNames ?? DEFAULT_SKIP_DIRS;
  const results: string[] = [];

  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirNames.has(entry.name)) {
          visit(absolutePath);
        }
        continue;
      }
      // tsup materializes bundled config modules beside the source config and
      // removes them when the build finishes. They are build-process state,
      // not repository source, and can disappear between this snapshot and a
      // boundary scanner reading the returned path.
      if (TRANSIENT_BUILD_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))) {
        continue;
      }
      if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
        results.push(absolutePath);
      }
    }
  };

  visit(options.rootDir);
  return results.sort();
}
