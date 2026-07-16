import type { PlaytestArtifact } from '@tileborne/services-build';
import { PlaytestHeadlessResult } from '@tileborne/services-build';
import { makeGameRuntime, makePluginHost } from '@tileborne/runtime';
import { Effect, Ref } from 'effect';

export const runHeadlessPlaytest = async (
  artifact: PlaytestArtifact,
  durationSec: number,
): Promise<PlaytestHeadlessResult> => {
  const hookCounts = await Effect.runPromise(Ref.make<Record<string, number>>({}));
  const runtime = makeGameRuntime();
  const host = makePluginHost({
    loader: {
      loadExecutable: (pluginId) =>
        Effect.succeed({
          default: {
            id: pluginId,
            onTick: () =>
              Effect.gen(function* () {
                const current = yield* Ref.get(hookCounts);
                yield* Ref.set(hookCounts, {
                  ...current,
                  [pluginId]: (current[pluginId] ?? 0) + 1,
                });
              }),
          },
        }),
    },
  });

  for (const pluginId of artifact.manifest.plugins) {
    await Effect.runPromise(host.loadAndRegister(pluginId));
  }

  await Effect.runPromise(runtime.init({ tickRate: 20, pluginHost: host }));
  await Effect.runPromise(runtime.start());
  const tickBudget = Math.max(1, Math.ceil(durationSec * 20));
  const stepped = await Effect.runPromise(runtime.step(tickBudget));
  await Effect.runPromise(runtime.stop());
  const summary = await Effect.runPromise(Ref.get(hookCounts));

  return new PlaytestHeadlessResult({
    ticks: stepped,
    durationSec,
    hookSummary: summary,
  });
};
