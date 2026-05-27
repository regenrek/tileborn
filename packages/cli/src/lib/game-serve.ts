import { createLocalGameHost, type LocalGameHost } from "@tileborne/services-build/local-game-host";

import { findAvailablePort } from "./listen-port.js";
import { signingKeyFingerprint } from "./multiplayer-playtest.js";
import { requestSignalExitCode } from "./shutdown.js";
import { disposeCliRuntime } from "../services-layer.js";
import { CliValidationError } from "../render/errors.js";
import { renderGameServeStatus, type RenderContext } from "../render/output.js";

const DEFAULT_BIND = "127.0.0.1";

export interface GameServeInput {
  readonly port: number;
  readonly signingKey: string | undefined;
  readonly bind: string;
}

export interface GameServeReady {
  readonly baseUrl: string;
  readonly signingKeyFingerprint: string;
  readonly port: number;
  readonly bind: string;
}

const readPortArg = (port: number): number => {
  if (!Number.isFinite(port) || port < 0) {
    throw new CliValidationError({ message: "port must be 0 (auto) or a positive integer" });
  }
  return port;
};

const readBindArg = (bind: string): string => {
  if (bind !== DEFAULT_BIND) {
    throw new CliValidationError({
      message: `bind must be ${DEFAULT_BIND} (local game-host launcher is fixed to loopback)`,
    });
  }
  return bind;
};

const installGameServeSignalHandlers = (shutdown: () => Promise<void>): void => {
  let active = false;
  const handler = (): void => {
    if (active) {
      return;
    }
    active = true;
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    void shutdown().finally(() => process.exit(0));
  };
  process.removeAllListeners("SIGINT");
  process.removeAllListeners("SIGTERM");
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
};

export const runGameServe = async (ctx: RenderContext, input: GameServeInput): Promise<never> => {
  const bind = readBindArg(input.bind);
  const port = await findAvailablePort(readPortArg(input.port), bind);
  requestSignalExitCode(0);

  let host: LocalGameHost | undefined;
  host = await createLocalGameHost({
    port,
    ...(input.signingKey === undefined ? {} : { signingKey: input.signingKey }),
  });

  const ready: GameServeReady = {
    baseUrl: host.baseUrl,
    signingKeyFingerprint: signingKeyFingerprint(host.signingKey),
    port,
    bind,
  };

  renderGameServeStatus(ctx, ready);

  installGameServeSignalHandlers(async () => {
    if (host) {
      await host.stop();
      host = undefined;
    }
    await disposeCliRuntime();
  });

  await new Promise<void>(() => undefined);
  return undefined as never;
};
