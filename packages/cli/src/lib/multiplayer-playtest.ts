import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { MapId } from '@tileborne/core';
import { PlaytestService } from '@tileborne/services-build';
import { createLocalGameHost, type LocalGameHost } from '@tileborne/services-build/local-game-host';
import { Effect } from 'effect';

import { findAvailablePort } from './listen-port.js';
import { resolveProjectId } from './project-context.js';
import { requestSignalExitCode } from './shutdown.js';
import { disposeCliRuntime, runCliEffect } from '../services-layer.js';
import { CliValidationError } from '../render/errors.js';
import { renderMultiplayerStatus, type RenderContext } from '../render/output.js';

const execFileAsync = promisify(execFile);

export interface MultiplayerPlaytestInput {
  readonly mapId: MapId;
  readonly projectSlug: string | undefined;
  readonly port: number;
  readonly players: number;
  readonly plugins: readonly string[];
  readonly open: boolean;
}

export interface MultiplayerPlaytestReady {
  readonly baseUrl: string;
  readonly roomId: string;
  readonly roomUrl: string;
  readonly wsUrl: string;
  readonly signingKeyFingerprint: string;
  readonly mapId: MapId;
  readonly port: number;
  readonly players: number;
  readonly deeplink: string;
  readonly artifactPath: string;
}

export const signingKeyFingerprint = (signingKey: string): string =>
  createHash('sha256').update(signingKey).digest('hex').slice(0, 12);

const toWebSocketUrl = (connectUrl: string): string =>
  connectUrl.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');

const readPlayersArg = (players: number): number => {
  if (!Number.isFinite(players) || players <= 0 || !Number.isInteger(players)) {
    throw new CliValidationError({ message: 'players must be a positive integer' });
  }
  return players;
};

const readPortArg = (port: number): number => {
  if (!Number.isFinite(port) || port < 0) {
    throw new CliValidationError({ message: 'port must be 0 (auto) or a positive integer' });
  }
  return port;
};

const bootstrapArtifact = (input: MultiplayerPlaytestInput) =>
  Effect.gen(function* () {
    const projectId = yield* resolveProjectId(input.projectSlug);
    const playtest = yield* PlaytestService;
    const artifact = yield* playtest.assembleArtifact({
      projectId,
      mapId: input.mapId,
      plugins: input.plugins,
    });
    return { projectId, artifact };
  });

const openDesktopClient = async (deeplink: string): Promise<void> => {
  const platform = process.platform;
  const opener = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  await execFileAsync(opener, [deeplink]).catch(() => undefined);
};

const installMultiplayerSignalHandlers = (shutdown: () => Promise<void>): void => {
  let active = false;
  const handler = (): void => {
    if (active) {
      return;
    }
    active = true;
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    void shutdown().finally(() => process.exit(0));
  };
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
};

export const runMultiplayerPlaytest = async (
  ctx: RenderContext,
  input: MultiplayerPlaytestInput,
): Promise<never> => {
  const players = readPlayersArg(input.players);
  const requestedPort = readPortArg(input.port);
  const { artifact } = await runCliEffect(bootstrapArtifact(input));
  const port = await findAvailablePort(requestedPort);
  requestSignalExitCode(0);

  let host: LocalGameHost | undefined;
  host = await createLocalGameHost({ port });
  const createResponse = await host.fetch(`${host.baseUrl}/rooms/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mapId: input.mapId,
      options: {
        maxPlayers: players,
        artifactPath: artifact.directory,
      },
    }),
  });
  if (!createResponse.ok) {
    await host.stop();
    host = undefined;
    throw new CliValidationError({ message: `room create failed: HTTP ${createResponse.status}` });
  }

  const created = (await createResponse.json()) as {
    readonly roomId: string;
    readonly wsUrl: string;
  };
  const wsUrl = toWebSocketUrl(created.wsUrl);
  const ready: MultiplayerPlaytestReady = {
    baseUrl: host.baseUrl,
    roomId: created.roomId,
    roomUrl: `${host.baseUrl}/rooms/${created.roomId}`,
    wsUrl,
    signingKeyFingerprint: signingKeyFingerprint(host.signingKey),
    mapId: input.mapId,
    port,
    players,
    deeplink: `tileborne://playtest/${created.roomId}`,
    artifactPath: artifact.directory,
  };

  renderMultiplayerStatus(ctx, ready);

  if (input.open) {
    await openDesktopClient(ready.deeplink);
  }

  installMultiplayerSignalHandlers(async () => {
    if (host) {
      await host.stop();
      host = undefined;
    }
    await disposeCliRuntime();
  });

  await new Promise<void>(() => undefined);
  return undefined as never;
};
