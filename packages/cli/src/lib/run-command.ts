import { Effect, ManagedRuntime } from "effect";

import { getCliRuntime, runCliEffect } from "../services-layer.js";
import { mapErrorToExitCode } from "../render/errors.js";
import { renderFailure, renderSuccess, setVerboseLevel, type RenderContext } from "../render/output.js";
import { readGlobalCliArgs, renderContextFromArgs, type CliRunContext } from "../commands/shared.js";

type CliRuntime = ReturnType<typeof getCliRuntime>;
type CliServices = ManagedRuntime.ManagedRuntime.Services<CliRuntime>;

export const runCliCommand = async <A, E>(
  context: CliRunContext,
  effect: Effect.Effect<A, E, CliServices>,
): Promise<void> => {
  const args = readGlobalCliArgs(context.args);
  const ctx = renderContextFromArgs(args);
  setVerboseLevel(args.verbose);
  try {
    const result = await runCliEffect(effect);
    renderSuccess(ctx, result);
  } catch (error) {
    renderFailure(ctx, error, mapErrorToExitCode(error));
  }
};

export const cliContext = (context: CliRunContext): RenderContext =>
  renderContextFromArgs(readGlobalCliArgs(context.args));
