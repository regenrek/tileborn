import path from "node:path";

import { MapId, ProjectId } from "@tileborne/core";
import { MapService } from "@tileborne/services-app";
import { HomeService } from "@tileborne/services-foundation";
import type { PluginInstallerServiceError } from "@tileborne/services-plugin";
import { PluginRegistryService } from "@tileborne/services-plugin";
import { Context, Effect, Layer, Option, PubSub, Ref, Stream } from "effect";

import type { MapServiceError } from "@tileborne/services-app";

import {
  PlaytestArtifact,
  PlaytestArtifactManifest,
  PlaytestOptions,
  PlaytestSession,
  PlaytestSessionId,
  PlaytestSessionNotFoundError,
  Running,
  ServicesBuildError,
  Starting,
  Stopped,
  emptyContentHash,
  makePlaytestSessionId,
} from "../model.js";
import {
  ensureDirectory,
  metadataFileName,
  verifiedChildPath,
  writeTextFile,
  writeVerifiedJson,
} from "../internal/persistence.js";

export const BATTLE_ROYALE_PLUGIN_ID = "@tileborne-plugins/battle-royale";

export const activeBattleRoyalePlaytestPluginIds = (
  plugins: readonly { readonly id: string; readonly enabled: boolean }[],
): readonly string[] =>
  plugins
    .filter((plugin) => plugin.enabled && plugin.id === BATTLE_ROYALE_PLUGIN_ID)
    .map((plugin) => plugin.id);

export interface AssemblePlaytestInput {
  readonly projectId: ProjectId;
  readonly mapId: MapId;
  readonly plugins?: readonly string[];
  readonly outputDirectory?: string;
}

export class PlaytestService extends Context.Service<PlaytestService, {
  readonly start: (
    projectId: ProjectId,
    mapId: MapId,
    options?: PlaytestOptions,
  ) => Effect.Effect<
    PlaytestSession,
    MapServiceError | ServicesBuildError | PluginInstallerServiceError
  >;
  readonly stop: (sessionId: PlaytestSessionId) => Effect.Effect<PlaytestSession, PlaytestSessionNotFoundError>;
  readonly list: () => Effect.Effect<readonly PlaytestSession[]>;
  readonly subscribe: Stream.Stream<void>;
  readonly assembleArtifact: (
    input: AssemblePlaytestInput,
  ) => Effect.Effect<PlaytestArtifact, MapServiceError | ServicesBuildError>;
}>()("@tileborne/services-build/PlaytestService") {}

const replaceSession = (
  sessions: readonly PlaytestSession[],
  next: PlaytestSession,
): readonly PlaytestSession[] => sessions.map((session) => (session.id === next.id ? next : session));

const optionValue = <A>(value: A | { readonly _tag: string; readonly value?: A } | undefined): A | undefined => {
  if (typeof value === "object" && value !== null && "_tag" in value) {
    return value._tag === "Some" ? value.value : undefined;
  }
  return value;
};

const mapToPersistedJson = (map: {
  readonly id: unknown;
  readonly schemaVersion: unknown;
  readonly size: { readonly width: number; readonly height: number };
  readonly tileSize: { readonly width: number; readonly height: number };
  readonly layers: readonly {
    readonly _tag: string;
    readonly id: unknown;
    readonly name: string;
    readonly visible: boolean;
    readonly opacity: number;
    readonly chunks?: readonly {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly tiles: readonly number[];
    }[];
    readonly objectIds?: readonly unknown[];
    readonly assetId?: unknown;
    readonly x?: number;
    readonly y?: number;
  }[];
  readonly objects: readonly {
    readonly id: unknown;
    readonly kind: string;
    readonly x: number;
    readonly y: number;
    readonly width?: unknown;
    readonly height?: unknown;
    readonly layerId: unknown;
    readonly properties: unknown;
  }[];
  readonly properties: unknown;
}): unknown => ({
  id: map.id,
  schemaVersion: map.schemaVersion,
  size: { width: map.size.width, height: map.size.height },
  tileSize: { width: map.tileSize.width, height: map.tileSize.height },
  layers: map.layers.map((layer) => {
    switch (layer._tag) {
      case "tile":
        return {
          kind: "tile",
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          chunks: (layer.chunks ?? []).map((chunk) => ({
            x: chunk.x,
            y: chunk.y,
            width: chunk.width,
            height: chunk.height,
            tiles: [...chunk.tiles],
          })),
        };
      case "object":
        return {
          kind: "object",
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          objectIds: [...(layer.objectIds ?? [])],
        };
      case "image":
        return {
          kind: "image",
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          assetId: layer.assetId,
          x: layer.x,
          y: layer.y,
        };
      case "collision":
        return {
          kind: "collision",
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          chunks: (layer.chunks ?? []).map((chunk) => ({
            x: chunk.x,
            y: chunk.y,
            width: chunk.width,
            height: chunk.height,
            tiles: [...chunk.tiles],
          })),
        };
      default:
        return {
          kind: "object",
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          objectIds: [],
        };
    }
  }),
  objects: map.objects.map((object) => ({
    id: object.id,
    kind: object.kind,
    x: object.x,
    y: object.y,
    width: optionValue(object.width),
    height: optionValue(object.height),
    layerId: object.layerId,
    properties: object.properties,
  })),
  properties: map.properties,
});

const playtestIndexHtml = (artifactDir: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Tileborne Playtest</title>
  </head>
  <body>
    <h1>Tileborne playtest artifact</h1>
    <p>Artifact directory: ${artifactDir}</p>
    <p>Open this page via <code>tileborne runtime serve</code>.</p>
  </body>
</html>
`;

const playtestArtifactDirectory = (playtestRoot: string, sessionId: PlaytestSessionId): string =>
  path.join(playtestRoot, sessionId.replace(":", "-"));

export const PlaytestServiceLive = Layer.effect(
  PlaytestService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const maps = yield* MapService;
    const registry = yield* PluginRegistryService;
    const paths = yield* home.init();
    const playtestRoot = path.join(paths.cache, "playtest");
    yield* ensureDirectory(playtestRoot);
    const sessions = yield* Ref.make<readonly PlaytestSession[]>([]);
    const events = yield* PubSub.unbounded<void>();

    const list = Effect.fn("PlaytestService.list")(function* () {
      return yield* Ref.get(sessions);
    });

    const assembleArtifact = Effect.fn("PlaytestService.assembleArtifact")(function* (
      input: AssemblePlaytestInput,
    ) {
      const map = yield* maps.load(input.projectId, input.mapId);
      const artifactId = `playtest-artifact-${Date.now()}`;
      const directory =
        input.outputDirectory ?? (yield* verifiedChildPath(playtestRoot, artifactId));
      yield* ensureDirectory(directory);
      const mapPath = path.join(directory, "map.json");
      const indexPath = path.join(directory, "index.html");
      const manifestPath = path.join(directory, metadataFileName);
      yield* Effect.tryPromise({
        try: async () => {
          const { writeFile } = await import("node:fs/promises");
          await writeFile(mapPath, `${JSON.stringify(mapToPersistedJson(map), null, 2)}\n`, "utf8");
        },
        catch: (cause) =>
          new ServicesBuildError({
            path: Option.some(mapPath),
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      yield* writeTextFile(indexPath, playtestIndexHtml(directory));
      const manifest = new PlaytestArtifactManifest({
        mapId: input.mapId,
        projectId: input.projectId,
        plugins: [...(input.plugins ?? [])],
        createdAt: new Date().toISOString(),
        integrityHash: emptyContentHash,
      });
      const integrityHash = yield* writeVerifiedJson(manifestPath, PlaytestArtifactManifest, manifest);
      return new PlaytestArtifact({
        directory,
        manifestPath,
        indexPath,
        mapPath,
        manifest: new PlaytestArtifactManifest({ ...manifest, integrityHash }),
      });
    });

    const start = Effect.fn("PlaytestService.start")(function* (
      projectId: ProjectId,
      mapId: MapId,
      options = new PlaytestOptions({
        slot: Option.none(),
        runtimeUrl: Option.none(),
        delayMs: Option.none(),
      }),
    ) {
      const sessionId = makePlaytestSessionId();
      const session = new PlaytestSession({
        id: sessionId,
        projectId,
        mapId,
        status: new Starting({}),
        startedAt: new Date().toISOString(),
        stoppedAt: Option.none(),
        runtimeUrl: options.runtimeUrl,
        artifactDirectory: Option.none(),
        activePlugins: [],
      });
      yield* Ref.update(sessions, (current) => [...current, session]);
      yield* PubSub.publish(events, void 0);

      const enabledPlugins = activeBattleRoyalePlaytestPluginIds(yield* registry.list());
      const artifact = yield* assembleArtifact({
        projectId,
        mapId,
        plugins: enabledPlugins,
        outputDirectory: playtestArtifactDirectory(playtestRoot, sessionId),
      });

      yield* Effect.sleep(Option.getOrElse(options.delayMs, () => 0));
      const running = new PlaytestSession({
        ...session,
        status: new Running({}),
        artifactDirectory: Option.some(artifact.directory),
        activePlugins: [...enabledPlugins],
      });
      yield* Ref.update(sessions, (current) => replaceSession(current, running));
      yield* PubSub.publish(events, void 0);
      return running;
    });

    const stop = Effect.fn("PlaytestService.stop")(function* (sessionId: PlaytestSessionId) {
      const current = yield* Ref.get(sessions);
      const session = current.find((entry) => entry.id === sessionId);
      if (!session) {
        yield* new PlaytestSessionNotFoundError({
          sessionId,
          message: `playtest session not found: ${sessionId}`,
        });
      }
      const stopped = new PlaytestSession({
        ...(session as PlaytestSession),
        status: new Stopped({}),
        stoppedAt: Option.some(new Date().toISOString()),
      });
      yield* Ref.update(sessions, (entries) => replaceSession(entries, stopped));
      yield* PubSub.publish(events, void 0);
      return stopped;
    });

    return {
      start,
      stop,
      list,
      subscribe: Stream.fromPubSub(events),
      assembleArtifact,
    };
  }),
);
