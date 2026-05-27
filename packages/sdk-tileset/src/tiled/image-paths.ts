import type { ParseDiagnostic } from "../diagnostics.js";

import {
  directoryName,
  isAbsoluteFilesystemPath,
  isPathInsideFolder,
  normalizePath,
  resolveAbsoluteProjectRoot,
  trimTrailingSlash,
} from "./external-resolve.js";
import type { TiledJsonTile, TiledJsonTileset } from "./types.js";

type NormalizedImagePath =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly diagnostic: ParseDiagnostic };

const pathDiagnostic = (
  source: string,
  resolvedPath: string,
  message: string,
): ParseDiagnostic => ({
  _tag: "TiledExternalRefBlocked",
  path: source,
  message,
  severity: "error",
  source,
  resolvedPath,
});

const nonStringDiagnostic = (path: string): ParseDiagnostic => ({
  _tag: "TiledParseError",
  path,
  message: "Tiled image source must be a string",
  severity: "error",
  format: "tmj",
});

export const normalizeTiledImageAssetPath = (
  value: unknown,
  diagnosticPath: string,
  context?: {
    readonly projectRoot: string;
    readonly basePath: string;
    readonly allowParentTraversalWithinRoot?: boolean | undefined;
  } | undefined,
): NormalizedImagePath => {
  if (typeof value !== "string") {
    return { ok: false, diagnostic: nonStringDiagnostic(diagnosticPath) };
  }

  if (value.includes("\0")) {
    return {
      ok: false,
      diagnostic: pathDiagnostic(value, value, "Tiled image source must not contain NUL bytes"),
    };
  }

  const source = value.replaceAll("\\", "/");
  if (source.startsWith("/") || /^[A-Za-z]:\//.test(source)) {
    return {
      ok: false,
      diagnostic: pathDiagnostic(value, source, "Tiled image source must be relative to the Tiled file"),
    };
  }

  if (context !== undefined) {
    const projectRoot = resolveAbsoluteProjectRoot(context.projectRoot);
    const baseDir = resolveAbsoluteProjectRoot(directoryName(context.basePath));
    if (!isAbsoluteFilesystemPath(projectRoot) || !isAbsoluteFilesystemPath(baseDir)) {
      return {
        ok: false,
        diagnostic: pathDiagnostic(value, source, "Tiled image source must resolve inside the project root"),
      };
    }
    const prefix = projectRoot.startsWith("/") ? "/" : /^[A-Za-z]:\//.test(projectRoot) ? projectRoot.slice(0, 3) : "";
    const baseSegments = trimTrailingSlash(normalizePath(baseDir).path)
      .slice(prefix.length)
      .split("/")
      .filter(Boolean);
    const boundarySegments = context.allowParentTraversalWithinRoot === true
      ? trimTrailingSlash(normalizePath(projectRoot).path).slice(prefix.length).split("/").filter(Boolean)
      : baseSegments;
    const segments = [...baseSegments];
    for (const segment of source.split("/")) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") {
        if (segments.length <= boundarySegments.length) {
          return {
            ok: false,
            diagnostic: pathDiagnostic(
              value,
              source,
              context.allowParentTraversalWithinRoot === true
                ? "Tiled image source must not escape the project root"
                : "Tiled image source must not escape the Tiled file directory",
            ),
          };
        }
        segments.pop();
        continue;
      }
      segments.push(segment);
    }
    const resolved = `${prefix}${segments.join("/")}`;
    const normalizedResolved = trimTrailingSlash(normalizePath(resolved).path);
    if (!isPathInsideFolder(projectRoot, normalizedResolved)) {
      return {
        ok: false,
        diagnostic: pathDiagnostic(value, normalizedResolved, "Tiled image source must not escape the project root"),
      };
    }
    const root = trimTrailingSlash(normalizePath(projectRoot).path);
    return {
      ok: true,
      path: normalizedResolved === root ? "" : normalizedResolved.slice(root.length + 1),
    };
  }

  const rawSegments = source.split("/").filter((segment) => segment !== "" && segment !== ".");
  const segments: string[] = [];
  for (const [index, segment] of rawSegments.entries()) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        return {
          ok: false,
          diagnostic: pathDiagnostic(
            value,
            ["..", ...rawSegments.slice(index + 1)].join("/"),
            "Tiled image source must not escape the Tiled file directory",
          ),
        };
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return { ok: true, path: segments.join("/") };
};

export const normalizeTiledTilesetImageAssetPaths = (
  tileset: TiledJsonTileset,
  context?: {
    readonly projectRoot: string;
    readonly basePath: string;
    readonly allowParentTraversalWithinRoot?: boolean | undefined;
  } | undefined,
): { readonly tileset?: TiledJsonTileset; readonly diagnostics: readonly ParseDiagnostic[] } => {
  const diagnostics: ParseDiagnostic[] = [];
  const rawImage: unknown = tileset.image;
  const normalizedImage =
    rawImage === undefined
      ? undefined
      : normalizeTiledImageAssetPath(rawImage, `/tilesets/${tileset.name}/image`, context);

  if (normalizedImage !== undefined && !normalizedImage.ok) {
    diagnostics.push(normalizedImage.diagnostic);
  }

  const normalizedTiles: TiledJsonTile[] = [];
  for (const tile of tileset.tiles ?? []) {
    const rawTileImage: unknown = tile.image;
    if (rawTileImage === undefined) {
      normalizedTiles.push(tile);
      continue;
    }

    const normalizedTileImage = normalizeTiledImageAssetPath(
      rawTileImage,
      `/tilesets/${tileset.name}/tiles/${tile.id}/image`,
      context,
    );
    if (!normalizedTileImage.ok) {
      diagnostics.push(normalizedTileImage.diagnostic);
      continue;
    }

    normalizedTiles.push({ ...tile, image: normalizedTileImage.path });
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics };
  }

  const imagePath = normalizedImage?.ok ? normalizedImage.path : undefined;
  return {
    tileset: {
      ...tileset,
      ...(imagePath === undefined ? {} : { image: imagePath }),
      ...(tileset.tiles === undefined ? {} : { tiles: normalizedTiles }),
    },
    diagnostics,
  };
};
