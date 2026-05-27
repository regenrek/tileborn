import type { ParseDiagnostic } from "../diagnostics.js";

export type NormalizedPath = {
  readonly path: string;
  readonly absolute: boolean;
  readonly hasTraversal: boolean;
};

export const normalizePath = (path: string): NormalizedPath => {
  const source = path.replaceAll("\\", "/");
  const absolute = source.startsWith("/") || /^[A-Za-z]:\//.test(source);
  const prefix = source.startsWith("/") ? "/" : /^[A-Za-z]:\//.test(source) ? source.slice(0, 3) : "";
  const rawSegments = source.slice(prefix.length).split("/");
  const segments: string[] = [];
  let hasTraversal = false;
  for (const segment of rawSegments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      hasTraversal = true;
      continue;
    }
    segments.push(segment);
  }
  return {
    path: `${prefix}${segments.join("/")}`,
    absolute,
    hasTraversal,
  };
};

export const directoryName = (path: string): string => {
  const normalized = path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return ".";
  return normalized.slice(0, index);
};

export const trimTrailingSlash = (value: string): string =>
  value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;

export const PATH_SEP = "/";

export const isAbsoluteFilesystemPath = (value: string): boolean => normalizePath(value).absolute;

const normalizeCanonicalAbsolutePath = (value: string): string => {
  const source = value.replaceAll("\\", "/");
  const prefix = source.startsWith("/")
    ? "/"
    : /^[A-Za-z]:\//.test(source)
      ? source.slice(0, 3)
      : "";
  if (prefix === "") {
    return source;
  }

  const segments: string[] = [];
  for (const segment of source.slice(prefix.length).split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0) {
        segments.pop();
      }
      continue;
    }
    segments.push(segment);
  }

  const path = segments.length === 0 && prefix === "/" ? "/" : `${prefix}${segments.join("/")}`;
  return trimTrailingSlash(path);
};

const currentWorkingDirectory = (): string => {
  const runtime = globalThis as { process?: { cwd?: () => string } };
  if (typeof runtime.process?.cwd === "function") {
    return normalizePath(runtime.process.cwd()).path;
  }
  return "";
};

export const resolvePath = (base: string, ...segments: string[]): string => {
  let accumulated = base;
  for (const segment of segments) {
    const normalized = normalizePath(segment);
    if (normalized.absolute) {
      accumulated = normalized.path;
      continue;
    }
    const baseTrimmed = trimTrailingSlash(normalizePath(accumulated).path);
    accumulated = normalizePath(`${baseTrimmed}/${normalized.path}`).path;
  }
  return accumulated;
};

/** Resolve a project root to an absolute directory path. */
export const resolveAbsoluteProjectRoot = (projectRoot: string): string => {
  const normalized = trimTrailingSlash(normalizePath(projectRoot).path);
  if (normalized === "" || normalized === ".") {
    return currentWorkingDirectory();
  }
  return isAbsoluteFilesystemPath(normalized)
    ? normalized
    : resolvePath(currentWorkingDirectory(), normalized);
};

export const isPathInsideFolder = (folder: string, candidate: string): boolean => {
  if (!isAbsoluteFilesystemPath(folder) || !isAbsoluteFilesystemPath(candidate)) {
    return false;
  }

  const root = normalizeCanonicalAbsolutePath(folder);
  const resolved = normalizeCanonicalAbsolutePath(candidate);
  return resolved === root || resolved.startsWith(root + PATH_SEP);
};

export type ResolveExternalPathInput = {
  readonly projectRoot: string;
  readonly basePath: string;
  readonly source: string;
  readonly realpath?: (absolutePath: string) => Promise<string> | string;
};

export type ResolveExternalPathResult =
  | { readonly ok: true; readonly absolutePath: string }
  | { readonly ok: false; readonly diagnostic: ParseDiagnostic };

export const resolveExternalPath = async (
  input: ResolveExternalPathInput,
): Promise<ResolveExternalPathResult> => {
  const normalizedSource = normalizePath(input.source);
  if (normalizedSource.hasTraversal) {
    return {
      ok: false,
      diagnostic: {
        _tag: "TiledExternalRefBlocked",
        path: input.source,
        message: "External reference must not contain path traversal segments",
        severity: "error",
        source: input.source,
        resolvedPath: normalizedSource.path,
      },
    };
  }

  const projectRoot = resolveAbsoluteProjectRoot(input.projectRoot);
  const baseDir = resolveAbsoluteProjectRoot(directoryName(input.basePath));
  const absolutePath = normalizedSource.absolute
    ? normalizedSource.path
    : resolvePath(baseDir, normalizedSource.path);

  const resolved = input.realpath
    ? trimTrailingSlash(normalizePath(await input.realpath(absolutePath)).path)
    : trimTrailingSlash(normalizePath(absolutePath).path);

  if (!isAbsoluteFilesystemPath(projectRoot) || !isAbsoluteFilesystemPath(resolved)) {
    return {
      ok: false,
      diagnostic: {
        _tag: "TiledExternalRefBlocked",
        path: input.source,
        message: "External reference must resolve to an absolute path inside the project root",
        severity: "error",
        source: input.source,
        resolvedPath: resolved,
      },
    };
  }

  if (!isPathInsideFolder(projectRoot, resolved)) {
    return {
      ok: false,
      diagnostic: {
        _tag: "TiledExternalRefBlocked",
        path: input.source,
        message: "External reference resolves outside the project root",
        severity: "error",
        source: input.source,
        resolvedPath: resolved,
      },
    };
  }

  return { ok: true, absolutePath: resolved };
};

export const readExternalText = async (
  readFile: (path: string) => Promise<string | Uint8Array> | string | Uint8Array,
  absolutePath: string,
): Promise<string> => {
  const raw = await readFile(absolutePath);
  return typeof raw === "string" ? raw : new TextDecoder().decode(raw);
};

export const isJsonTilesetSource = (source: string): boolean => {
  const lower = source.toLowerCase();
  return lower.endsWith(".json") || lower.endsWith(".tsj");
};

export const isXmlTilesetSource = (source: string): boolean => lowerEndsWith(source, ".tsx");

export const isSupportedTilesetSource = (source: string): boolean =>
  isJsonTilesetSource(source) || isXmlTilesetSource(source);

const lowerEndsWith = (value: string, suffix: string): boolean =>
  value.toLowerCase().endsWith(suffix);

export const tilesetIdFromSource = (source: string): string => {
  const filename = source.replaceAll("\\", "/").split("/").pop() ?? source;
  return filename
    .replace(/\.tileset\.tsx$/i, "")
    .replace(/\.tileset\.json$/i, "")
    .replace(/\.tsx$/i, "")
    .replace(/\.tsj$/i, "")
    .replace(/\.json$/i, "");
};
