import type { MainTileborneBridge } from "@tileborne/ipc-contracts";

export type Unsubscribe = () => void;

export interface PreloadIpcTransport {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  subscribe(channel: string, onPayload: (payload: unknown) => void): Unsubscribe;
}

export const MAIN_IPC_BRIDGE_CHANNELS = [
  "tileborne:projects:list",
  "tileborne:projects:get",
  "tileborne:projects:create",
  "tileborne:projects:update",
  "tileborne:projects:delete",
  "tileborne:projects:open",
  "tileborne:projects:close",
  "tileborne:projects:importFromDirectory",
  "tileborne:projects:exportArchive",
  "tileborne:maps:list",
  "tileborne:maps:get",
  "tileborne:maps:create",
  "tileborne:maps:update",
  "tileborne:maps:setMapTilesetPack",
  "tileborne:maps:scanTiled",
  "tileborne:maps:importTiled",
  "tileborne:maps:delete",
  "tileborne:maps:generate",
  "tileborne:assets:listPacks",
  "tileborne:assets:getPack",
  "tileborne:assets:describePack",
  "tileborne:assets:detectImportSource",
  "tileborne:assets:importPack",
  "tileborne:assets:importSpriteSheet",
  "tileborne:assets:removePack",
  "tileborne:assets:listPackAssets",
  "tileborne:assets:getAssetDataUrl",
  "tileborne:asset-library:getPackLibrary",
  "tileborne:asset-library:getPackCacheStatus",
  "tileborne:asset-library:reloadPackCache",
  "tileborne:asset-library:resolvePreviews",
  "tileborne:asset-library:getEditorIndex",
  "tileborne:working-palettes:list",
  "tileborne:working-palettes:getActive",
  "tileborne:working-palettes:create",
  "tileborne:working-palettes:update",
  "tileborne:working-palettes:delete",
  "tileborne:working-palettes:setActive",
  "tileborne:working-palettes:addItems",
  "tileborne:working-palettes:removeItem",
  "tileborne:working-palettes:reorderItems",
  "tileborne:catalog:resolve",
  "tileborne:catalog:validate",
  "tileborne:catalog:import",
  "tileborne:catalog:export",
  "tileborne:plugins:list",
  "tileborne:plugins:install",
  "tileborne:plugins:installBundledBattleRoyale",
  "tileborne:plugins:uninstall",
  "tileborne:plugins:enable",
  "tileborne:plugins:disable",
  "tileborne:plugins:getManifest",
  "tileborne:plugins:listContributions",
  "tileborne:plugins:invokeEditorCommand",
  "tileborne:jobs:list",
  "tileborne:jobs:get",
  "tileborne:jobs:cancel",
  "tileborne:logs:listRecent",
  "tileborne:tiled-import:scan",
  "tileborne:tiled-import:plan",
  "tileborne:tiled-import:apply",
  "tileborne:tiled-import:cancel",
  "tileborne:builds:build",
  "tileborne:builds:getBuild",
  "tileborne:builds:listBuilds",
  "tileborne:builds:deleteBuild",
  "tileborne:exports:exportBuild",
  "tileborne:exports:getExport",
  "tileborne:exports:listExports",
  "tileborne:exports:deleteExport",
  "tileborne:tiled-source-rules:compilePreview",
  "tileborne:tiled-source-rules:runtimeApply",
  "tileborne:playtest:start",
  "tileborne:playtest:stop",
  "tileborne:playtest:list",
  "tileborne:runtime:startLocalHost",
  "tileborne:runtime:stopLocalHost",
  "tileborne:runtime:playtestInput",
  "tileborne:runtime:playtestSnapshot",
  "tileborne:runtime-deploy:deploy",
  "tileborne:runtime-deploy:getDeployment",
  "tileborne:runtime-deploy:listDeployments",
  "tileborne:runtime-deploy:deleteDeployment",
  "tileborne:support:createBundle",
  "tileborne:support:getBundle",
  "tileborne:support:listBundles",
  "tileborne:support:deleteBundle",
  "tileborne:system:ping",
  "tileborne:system:getVersion",
  "tileborne:system:getHomePaths",
  "tileborne:system:pickDirectory",
  "tileborne:system:pickImportSource",
  "tileborne:system:openPlaytestJoinWindow",
] as const;

export const MAIN_EVENT_BRIDGE_CHANNELS = [
  "tileborne:projects:changed",
  "tileborne:maps:changed",
  "tileborne:assets:changed",
  "tileborne:assets:capabilityRefreshed",
  "tileborne:plugins:changed",
  "tileborne:jobs:changed",
  "tileborne:builds:changed",
  "tileborne:exports:changed",
  "tileborne:playtest:changed",
  "tileborne:deployments:changed",
  "tileborne:support:changed",
  "tileborne:logs:appended",
  "tileborne:runtime:snapshot",
  "tileborne:tiled-source-rules:compile-progress",
  "tileborne:tiled-source-rules:runtime-apply-progress",
  "tileborne:tiled-source-rules:diagnostics",
] as const;

const PRELOAD_IPC_TIMEOUT_MS = {
  "tileborne:projects:create": 30_000,
  "tileborne:projects:update": 30_000,
  "tileborne:projects:delete": 30_000,
  "tileborne:projects:open": 30_000,
  "tileborne:projects:importFromDirectory": 120_000,
  "tileborne:projects:exportArchive": 120_000,
  "tileborne:maps:create": 30_000,
  "tileborne:maps:update": 30_000,
  "tileborne:maps:setMapTilesetPack": 30_000,
  "tileborne:maps:scanTiled": 30_000,
  "tileborne:maps:importTiled": 30_000,
  "tileborne:maps:generate": 30_000,
  "tileborne:assets:importPack": 120_000,
  "tileborne:assets:importSpriteSheet": 120_000,
  "tileborne:working-palettes:create": 30_000,
  "tileborne:working-palettes:update": 30_000,
  "tileborne:working-palettes:delete": 30_000,
  "tileborne:plugins:install": 120_000,
  "tileborne:plugins:installBundledBattleRoyale": 120_000,
  "tileborne:plugins:uninstall": 60_000,
  "tileborne:plugins:invokeEditorCommand": 60_000,
  "tileborne:tiled-import:scan": 30_000,
  "tileborne:tiled-import:plan": 30_000,
  "tileborne:tiled-import:apply": 120_000,
  "tileborne:builds:build": 120_000,
  "tileborne:exports:exportBuild": 120_000,
  "tileborne:runtime-deploy:deploy": 120_000,
  "tileborne:support:createBundle": 120_000,
} as const satisfies Partial<Record<(typeof MAIN_IPC_BRIDGE_CHANNELS)[number], number>>;
const preloadIpcTimeoutMs: Partial<Record<(typeof MAIN_IPC_BRIDGE_CHANNELS)[number], number>> =
  PRELOAD_IPC_TIMEOUT_MS;

const IPC_ERROR_TAGS = new Set([
  "IpcChannelNotFoundError",
  "IpcValidationError",
  "IpcTimeoutError",
  "IpcHandlerThrewError",
  "IpcPermissionDeniedError",
  "IpcSerializationError",
  "IpcTransportError",
  "IpcDecodeError",
  "InvalidSourceManifestError",
  "MissingTilesetError",
  "InvalidRuleOptionError",
  "ContradictoryRuleError",
]);

const capitalizeKebab = (segment: string): string =>
  segment
    .split("-")
    .map((part) => (part.length === 0 ? part : `${part[0]!.toUpperCase()}${part.slice(1)}`))
    .join("");

const lowerCamelKebab = (segment: string): string => {
  const [first = "", ...rest] = segment.split("-");
  return `${first}${rest.map(capitalizeKebab).join("")}`;
};

const splitTileborneChannel = (
  channel: string,
): { readonly domain: string; readonly method: string } => {
  const match = /^tileborne:([a-z][a-z0-9-]*):([a-z][a-zA-Z0-9-]*)$/.exec(channel);
  if (!match) {
    throw new Error(`Unknown IPC channel: ${channel}`);
  }
  return {
    domain: lowerCamelKebab(match[1]!),
    method: match[2]!,
  };
};

export const toPreloadEventHandlerName = (channel: string): string => {
  const match = /^tileborne:([a-z][a-z0-9-]*):([a-z][a-zA-Z0-9-]*)$/.exec(channel);
  if (!match) {
    throw new Error(`Unknown IPC event channel: ${channel}`);
  }
  return `on${capitalizeKebab(match[1]!)}${capitalizeKebab(match[2]!)}`;
};

const isTaggedIpcError = (payload: unknown): payload is { readonly _tag: string } =>
  typeof payload === "object" &&
  payload !== null &&
  "_tag" in payload &&
  typeof payload._tag === "string" &&
  IPC_ERROR_TAGS.has(payload._tag);

const invokeWithTimeout = (
  transport: PreloadIpcTransport,
  channel: (typeof MAIN_IPC_BRIDGE_CHANNELS)[number],
  payload: unknown,
): Promise<unknown> => {
  const timeoutMs = preloadIpcTimeoutMs[channel];
  const invocation = transport.invoke(channel, payload).then((response) => {
    if (isTaggedIpcError(response)) {
      throw response;
    }
    return response;
  });

  if (timeoutMs === undefined) {
    return invocation;
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject({
        _tag: "IpcTimeoutError",
        channel,
        timeoutMs,
        message: `IPC request timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    invocation.then(
      (response) => {
        window.clearTimeout(timeoutId);
        resolve(response);
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
};

export const buildTilebornePreloadBridge = (
  transport: PreloadIpcTransport,
): MainTileborneBridge => {
  const bridge: Record<string, Record<string, (request: unknown) => Promise<unknown>>> = {};

  for (const channel of MAIN_IPC_BRIDGE_CHANNELS) {
    const { domain, method } = splitTileborneChannel(channel);
    bridge[domain] ??= {};
    bridge[domain]![method] = (request) => invokeWithTimeout(transport, channel, request);
  }

  const events: Record<string, (handler: (payload: unknown) => void) => Unsubscribe> = {};
  for (const channel of MAIN_EVENT_BRIDGE_CHANNELS) {
    events[toPreloadEventHandlerName(channel)] = (handler) => transport.subscribe(channel, handler);
  }

  return {
    ...bridge,
    events,
  } as MainTileborneBridge;
};
