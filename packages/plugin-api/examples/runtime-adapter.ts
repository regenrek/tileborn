import type { CreateRuntimeAdapter, RuntimeAdapterHost } from '@tileborne/plugin-api';

export interface ExampleRuntimeHost extends RuntimeAdapterHost {
  readonly emit: (event: { readonly kind: string; readonly tick: number }) => void;
}

/** Compile-checked reference for the exact named export consumed by Ship/game-host. */
export const createRuntimeAdapter: CreateRuntimeAdapter<ExampleRuntimeHost> = (host) => ({
  id: '@tileborne-plugins/example-gameplay',
  onInit(context, world) {
    world.registerComponent<{ readonly started: boolean }>('example.started');
    host.emit({ kind: `${context.pluginId}.started`, tick: 0 });
  },
  onTick(_world, _deltaSeconds, tick) {
    host.emit({ kind: 'example.tick', tick });
  },
});
