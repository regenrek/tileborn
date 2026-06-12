import { access } from "node:fs/promises";
import path from "node:path";

import {
  createLocalGameHost,
  resolveBundledGameHostWorkerPath,
  type LocalGameHost,
} from "@tileborne/services-build/local-game-host";

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
  /** Built game artifact directory (`game build --target local`); undefined = dev game-host bundle. */
  readonly dir: string | undefined;
}

export interface GameServeReady {
  readonly baseUrl: string;
  readonly signingKeyFingerprint: string;
  readonly port: number;
  readonly bind: string;
  readonly workerPath: string;
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

/** Resolve the worker bundle to boot: a built artifact directory or the dev game-host bundle. */
const resolveWorkerPath = async (dir: string | undefined): Promise<string> => {
  if (dir === undefined) {
    return resolveBundledGameHostWorkerPath();
  }
  const workerPath = path.resolve(dir, "worker.js");
  try {
    await access(workerPath);
  } catch {
    throw new CliValidationError({
      message: `no worker.js found in ${path.resolve(dir)} — build one with \`tileborne game build --target local --out ${path.resolve(dir)}\``,
    });
  }
  return workerPath;
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
  const workerPath = await resolveWorkerPath(input.dir);
  const port = await findAvailablePort(readPortArg(input.port), bind);
  requestSignalExitCode(0);

  let host: LocalGameHost | undefined;
  host = await createLocalGameHost({
    port,
    workerPath,
    ...(input.signingKey === undefined ? {} : { signingKey: input.signingKey }),
  });

  const ready: GameServeReady = {
    baseUrl: host.baseUrl,
    signingKeyFingerprint: signingKeyFingerprint(host.signingKey),
    port,
    bind,
    workerPath,
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
