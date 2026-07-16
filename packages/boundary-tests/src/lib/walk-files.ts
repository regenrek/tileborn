import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.vite', 'out']);

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
      if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
        results.push(absolutePath);
      }
    }
  };

  visit(options.rootDir);
  return results.sort();
}
