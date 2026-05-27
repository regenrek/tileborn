import path from "node:path";
import { realpath } from "node:fs/promises";

export class AssetPathSecurityError extends Error {
  readonly rootPath: string;
  readonly candidatePath: string;

  constructor(message: string, rootPath: string, candidatePath: string) {
    super(message);
    this.name = "AssetPathSecurityError";
    this.rootPath = rootPath;
    this.candidatePath = candidatePath;
  }
}

export const assertWithinRoot = (rootPath: string, candidatePath: string): string => {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(resolvedRoot, candidatePath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolvedCandidate;
  }

  throw new AssetPathSecurityError(
    `Path escapes root: ${candidatePath}`,
    resolvedRoot,
    resolvedCandidate,
  );
};

export const rejectPathTraversal = (rootPath: string, candidatePath: string): string => {
  const normalized = candidatePath.replaceAll(path.win32.sep, path.posix.sep);
  const segments = path.posix.normalize(normalized).split(path.posix.sep);

  if (path.posix.isAbsolute(normalized) || segments.includes("..")) {
    throw new AssetPathSecurityError(`Path traversal is not allowed: ${candidatePath}`, rootPath, candidatePath);
  }

  return assertWithinRoot(rootPath, candidatePath);
};

export const rejectSymlinkEscape = async (
  rootPath: string,
  candidatePath: string,
): Promise<string> => {
  const resolvedCandidate = assertWithinRoot(rootPath, candidatePath);
  const [realRoot, realCandidate] = await Promise.all([
    realpath(path.resolve(rootPath)),
    realpath(resolvedCandidate),
  ]);
  const relative = path.relative(realRoot, realCandidate);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return realCandidate;
  }

  throw new AssetPathSecurityError(
    `Symlink escapes root: ${candidatePath}`,
    realRoot,
    realCandidate,
  );
};
