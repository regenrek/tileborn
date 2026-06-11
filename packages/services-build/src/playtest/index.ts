import path from "node:path";

import { type GameModeId, MapId, ProjectId } from "@tileborne/core";
import {
  discoverGameModes,
  type GameModeDescriptor,
  type GameModeManifest,
  resolveActiveGameMode,
} from "@tileborne/plugin-api";
import { MapService, ProjectService } from "@tileborne/services-app";
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
import { readProjectActiveGameModeId } from "./active-game-mode-selection.js";

/**
 * The bundled battle-royale plugin id. Retained ONLY as a test fixture / assertion
 * literal (see `services-build.test.ts`); it is deliberately NOT used by the
 * playtest selection logic below, which is manifest-driven (ADR-0023).
 */
export const BATTLE_ROYALE_PLUGIN_ID = "@tileborne-plugins/battle-royale";

/**
 * A plugin candidate for playtest mode selection: its manifest (id + decoded
 * {@link GameModeManifest} contributions) paired with whether the project has it
 * enabled.
 */
export interface PlaytestModeCandidate extends GameModeManifest {
  readonly enabled: boolean;
}

const enabledPlaytestGameModes = (
  candidates: readonly PlaytestModeCandidate[],
): readonly GameModeDescriptor[] =>
  discoverGameModes(
    candidates
      .filter((candidate) => candidate.enabled)
      .map(({ pluginId, contributions }): GameModeManifest => ({ pluginId, contributions })),
  );

/**
 * Manifest-driven playtest mode selection (ADR-0023 section B).
 *
 * Discovers the selectable game modes from the ENABLED plugins' decoded
 * contributions ({@link discoverGameModes}: a plugin is a mode when it declares a
 * runtime system) and activates the resolved active mode. Multi-mode projects
 * require an explicit active-mode selection; invalid selections resolve to no
 * plugin so PlaytestService can fail fast with an actionable error. There is NO
 * hardcoded plugin id: a new genre plugin that declares a runtime system becomes
 * selectable with zero engine edits. Battle royale stays selectable only because
 * it declares a runtime system, just like any other mode.
 */
export const activePlaytestPluginIds = (
  candidates: readonly PlaytestModeCandidate[],
  selection?: GameModeId | undefined,
): readonly string[] => {
  const active = resolveActiveGameMode(enabledPlaytestGameModes(candidates), selection);
  return active === undefined ? [] : [active.pluginId];
};

const modeLabel = (mode: GameModeDescriptor): string => `${mode.label} (${mode.modeId})`;

const describeActiveModeSelectionIssue = (
  modes: readonly GameModeDescriptor[],
  selection?: GameModeId | undefined,
): string | undefined => {
  if (selection !== undefined) {
    if (modes.length === 0) {
      return `Selected active game mode ${selection} is not available because no enabled plugin declares a runtime system.`;
    }
    return [
      `Selected active game mode ${selection} is not enabled or does not declare a runtime system.`,
      `Available modes: ${modes.map(modeLabel).join(", ")}.`,
    ].join(" ");
  }
  if (modes.length > 1) {
    return [
      `Multiple enabled game modes are available (${modes.map(modeLabel).join(", ")}).`,
      "Select an active game mode before starting playtest.",
    ].join(" ");
  }
  return undefined;
};

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
    const projects = yield* ProjectService;
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
      // Validate the map exists and decodes before creating the artifact
      // directory; the map itself ships ONLY inside the runtime map package
      // (`assembleRuntimeMapPackage` is the single writer of `map.json`).
      yield* maps.load(input.projectId, input.mapId);
      const artifactId = `playtest-artifact-${Date.now()}`;
      const directory =
        input.outputDirectory ?? (yield* verifiedChildPath(playtestRoot, artifactId));
      yield* ensureDirectory(directory);
      const indexPath = path.join(directory, "index.html");
      const manifestPath = path.join(directory, metadataFileName);
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
      const project = yield* projects.open(projectId);
      const installed = yield* registry.list();
      const modeCandidates = installed.map((plugin) => ({
        pluginId: plugin.id,
        enabled: plugin.enabled,
        contributions: plugin.manifest.contributes,
      }));
      const activeModeSelection = readProjectActiveGameModeId(project);
      const availableModes = enabledPlaytestGameModes(modeCandidates);
      const enabledPlugins = activePlaytestPluginIds(
        modeCandidates,
        activeModeSelection,
      );
      const modeSelectionIssue = enabledPlugins.length === 0
        ? describeActiveModeSelectionIssue(availableModes, activeModeSelection)
        : undefined;
      if (modeSelectionIssue !== undefined) {
        yield* new ServicesBuildError({ path: Option.none(), message: modeSelectionIssue });
      }

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
