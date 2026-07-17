import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { cp, lstat, mkdir, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const within = (root, candidate) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

export const inventoryArtifact = async (directory) => {
  const root = await realpath(directory);
  const files = [];
  const visit = async (current) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        const resolved = await realpath(absolute);
        if (!within(root, resolved)) {
          throw new Error(`artifact symlink escapes root: ${relative} -> ${resolved}`);
        }
        throw new Error(`shipped artifact must not contain symlinks: ${relative}`);
      }
      if (metadata.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!metadata.isFile()) throw new Error(`unsupported artifact entry: ${relative}`);
      const bytes = await readFile(absolute);
      files.push({ path: relative, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
  };
  await visit(root);
  const treeBytes = Buffer.from(`${JSON.stringify(files)}\n`);
  return { files, treeSha256: sha256(treeBytes) };
};

export const snapshotShippedArtifact = async ({ sourceDirectory, evidenceRoot }) => {
  const sourceRoot = await realpath(sourceDirectory);
  const resolvedEvidenceRoot = await realpath(evidenceRoot);
  if (within(sourceRoot, resolvedEvidenceRoot)) {
    throw new Error('evidence root must not be inside the shipped artifact');
  }
  const source = await inventoryArtifact(sourceRoot);
  const destinationDirectory = path.join(resolvedEvidenceRoot, 'shipped-game');
  await mkdir(destinationDirectory, { recursive: false });
  await cp(sourceRoot, destinationDirectory, { recursive: true, preserveTimestamps: true });
  const destination = await inventoryArtifact(destinationDirectory);
  if (JSON.stringify(destination) !== JSON.stringify(source)) {
    throw new Error('shipped artifact snapshot does not match source inventory');
  }
  return {
    sourceDirectory: sourceRoot,
    directory: 'shipped-game',
    ...destination,
  };
};
