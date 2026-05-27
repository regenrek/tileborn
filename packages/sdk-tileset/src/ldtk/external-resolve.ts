import type { ParseDiagnostic } from "../diagnostics.js";
import {
  directoryName,
  isAbsoluteFilesystemPath,
  isPathInsideFolder,
  normalizePath,
  resolveAbsoluteProjectRoot,
  resolvePath,
  trimTrailingSlash,
} from "../tiled/external-resolve.js";

export type FileReadResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/** Injected relative-path reader used for external LDtk level files. */
export type FileReader = (relativePath: string) => FileReadResult;

const normalizeSlashes = (value: string): string => value.replace(/\\/g, "/");

/** Join a project base directory with a relative LDtk path. */
export const joinProjectRelativePath = (projectPath: string, relativePath: string): string => {
  const base = normalizeSlashes(projectPath).replace(/\/[^/]+$/, "");
  const rel = normalizeSlashes(relativePath).replace(/^\.\//, "");
  if (rel.startsWith("/")) {
    return rel;
  }
  return `${base}/${rel}`.replace(/\/+/g, "/");
};

/** Read and parse JSON from a project-relative path via an injected reader. */
export const readProjectJson = (
  readFile: FileReader,
  relativePath: string,
): { readonly value?: unknown; readonly error?: string } => {
  const result = readFile(relativePath);
  if (!result.ok) {
    return { error: result.reason };
  }
  try {
    return { value: JSON.parse(result.text) as unknown };
  } catch {
    return { error: `Invalid JSON in ${relativePath}` };
  }
};

export type ResolveExternalLevelInput = {
  readonly projectPath: string;
  readonly externalRelPath: string;
  readonly readFile: FileReader;
  readonly realpath?: (absolutePath: string) => string;
};

export type ResolveExternalLevelResult =
  | { readonly ok: true; readonly level: unknown }
  | { readonly ok: false; readonly diagnostic: ParseDiagnostic };

const blockedDiagnostic = (
  externalRelPath: string,
  projectPath: string,
  message: string,
  resolvedPath: string,
): ParseDiagnostic => ({
  _tag: "LdtkExternalRefBlocked",
  path: `${projectPath}/${externalRelPath}`,
  message,
  severity: "error",
  externalRelPath,
  resolvedPath,
});

/** Resolve an external LDtk level (`.ldtkl`) referenced from the project root. */
export const resolveExternalLevel = (
  input: ResolveExternalLevelInput,
): ResolveExternalLevelResult => {
  if (input.projectPath.trim() === "") {
    return {
      ok: false,
      diagnostic: blockedDiagnostic(
        input.externalRelPath,
        input.projectPath,
        "LDtk project path must not be empty",
        input.projectPath,
      ),
    };
  }

  const normalizedSource = normalizePath(input.externalRelPath);
  if (normalizedSource.hasTraversal) {
    return {
      ok: false,
      diagnostic: blockedDiagnostic(
        input.externalRelPath,
        input.projectPath,
        "External level reference must not contain path traversal segments",
        normalizedSource.path,
      ),
    };
  }

  if (normalizedSource.absolute) {
    return {
      ok: false,
      diagnostic: blockedDiagnostic(
        input.externalRelPath,
        input.projectPath,
        "External level reference must be relative to the LDtk project",
        normalizedSource.path,
      ),
    };
  }

  const projectRoot = resolveAbsoluteProjectRoot(directoryName(input.projectPath));
  const absolutePath = trimTrailingSlash(
    normalizePath(resolvePath(projectRoot, normalizedSource.path)).path,
  );
  const resolved = input.realpath
    ? trimTrailingSlash(normalizePath(input.realpath(absolutePath)).path)
    : absolutePath;

  if (!isAbsoluteFilesystemPath(projectRoot) || !isAbsoluteFilesystemPath(resolved)) {
    return {
      ok: false,
      diagnostic: blockedDiagnostic(
        input.externalRelPath,
        input.projectPath,
        "External level reference must resolve to an absolute path inside the LDtk project root",
        resolved,
      ),
    };
  }

  if (!isPathInsideFolder(projectRoot, resolved)) {
    return {
      ok: false,
      diagnostic: blockedDiagnostic(
        input.externalRelPath,
        input.projectPath,
        "External level reference resolves outside the LDtk project root",
        resolved,
      ),
    };
  }

  const safeRelativePath = normalizedSource.path;
  const { value, error } = readProjectJson(input.readFile, safeRelativePath);
  if (error !== undefined) {
    return {
      ok: false,
      diagnostic: {
        _tag: "LdtkExternalLevelMissing",
        path: `${input.projectPath}/${safeRelativePath}`,
        message: error,
        severity: "error",
        externalRelPath: safeRelativePath,
      },
    };
  }

  return { ok: true, level: value };
};
