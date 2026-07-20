import {
  applyGameShellAuthoringCommand,
  buildRuntimeGameShellProjection,
  decodeRuntimeGameShellProjection,
  defaultProjectGameShellState,
  type GameShellDiagnostic,
  type RuntimeGameShellProjection,
} from '@tileborne/runtime';

export interface ShippedShellBootstrap {
  readonly projection: RuntimeGameShellProjection;
  readonly sourceUrlBase: string;
}

export const defaultShippedShellProjection = (
  pluginId = 'tileborne.default',
): RuntimeGameShellProjection =>
  buildRuntimeGameShellProjection(
    applyGameShellAuthoringCommand(defaultProjectGameShellState(pluginId), {
      type: 'set-entry-screen',
      screenId: 'main-menu',
    }),
  );

const fallbackWithDiagnostic = (
  fallback: RuntimeGameShellProjection,
  diagnostic: GameShellDiagnostic,
): RuntimeGameShellProjection => ({
  ...fallback,
  diagnostics: [...fallback.diagnostics, diagnostic],
});

export const loadShippedShellProjection = async (options: {
  readonly fetchImpl?: typeof fetch | undefined;
  readonly mapId: string;
  readonly fallbackPluginId?: string | undefined;
}): Promise<ShippedShellBootstrap> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const mapPackageDirectory = `maps/${options.mapId.replaceAll(':', '-')}`;
  const fallback = defaultShippedShellProjection(options.fallbackPluginId);
  const response = await fetchImpl(`${mapPackageDirectory}/shell.json`).catch(() => undefined);
  if (response === undefined || !response.ok) {
    return {
      projection: fallbackWithDiagnostic(fallback, {
        code: 'invalid-route',
        path: `${mapPackageDirectory}/shell.json`,
        message: 'Packaged shell.json is unavailable; rendering the default shell.',
      }),
      sourceUrlBase: mapPackageDirectory,
    };
  }
  const payload = await response.json().catch(() => undefined);
  const projection = decodeRuntimeGameShellProjection(payload);
  return {
    projection:
      projection ??
      fallbackWithDiagnostic(fallback, {
        code: 'invalid-route',
        path: `${mapPackageDirectory}/shell.json`,
        message: 'Packaged shell.json is malformed; rendering the default shell.',
      }),
    sourceUrlBase: mapPackageDirectory,
  };
};
