import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  awaitViewportDisposeChain,
  chainViewportDispose,
  resetViewportDisposeChainForTests,
  startSerializedViewportMount,
} from './viewport/viewport-mount-lifecycle.js';

const mountMock = vi.fn();
const disposeMock = vi.fn();
const loadAssetsMock = vi.fn();
const resizeMock = vi.fn();
const requestRenderMock = vi.fn();
const getEditorWorldRootMock = vi.fn();

vi.mock('@tileborne/runtime', () => ({
  PixiRendererAdapter: class PixiRendererAdapter {
    mount = mountMock.mockReturnValue(Effect.succeed({ container: {} }));
    loadAssets = loadAssetsMock.mockReturnValue(Effect.succeed(new Map()));
    dispose = disposeMock.mockReturnValue(Effect.succeed(undefined));
    resize = resizeMock.mockReturnValue(Effect.succeed(undefined));
    requestRender = requestRenderMock.mockReturnValue(Effect.succeed(undefined));
    getEditorWorldRoot = getEditorWorldRootMock.mockReturnValue({
      addChild: vi.fn(),
      scale: { set: vi.fn() },
      position: { set: vi.fn() },
      sortableChildren: false,
    });
  },
}));

vi.mock('pixi.js', () => ({
  Container: class Container {
    label = '';
    zIndex = 0;
    visible = true;
    addChild = vi.fn();
    removeChildren = vi.fn();
  },
  Graphics: class Graphics {
    clear = vi.fn().mockReturnThis();
    rect = vi.fn().mockReturnThis();
    fill = vi.fn().mockReturnThis();
    stroke = vi.fn().mockReturnThis();
    moveTo = vi.fn().mockReturnThis();
    lineTo = vi.fn().mockReturnThis();
    setStrokeStyle = vi.fn().mockReturnThis();
    circle = vi.fn().mockReturnThis();
  },
  Text: class Text {
    text = '';
    constructor() {}
  },
}));

describe('viewport mount lifecycle', () => {
  beforeEach(() => {
    resetViewportDisposeChainForTests();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('mounts PixiRendererAdapter and disposes on teardown', async () => {
    const [{ EditorViewportController }, { PixiRendererAdapter }] = await Promise.all([
      import('./viewport/editor-viewport-controller.js'),
      import('@tileborne/runtime'),
    ]);
    const adapter = new PixiRendererAdapter();
    const container = document.createElement('div');
    await Effect.runPromise(adapter.mount(container));
    await Effect.runPromise(adapter.loadAssets({ assets: [] } as never));
    const controller = new EditorViewportController(adapter);
    await controller.dispose();
    expect(mountMock).toHaveBeenCalledTimes(1);
    expect(loadAssetsMock).toHaveBeenCalledTimes(1);
    expect(disposeMock).toHaveBeenCalledTimes(1);
  });

  it('resize forwards dimensions to adapter', async () => {
    const [{ EditorViewportController }, { PixiRendererAdapter }] = await Promise.all([
      import('./viewport/editor-viewport-controller.js'),
      import('@tileborne/runtime'),
    ]);
    const adapter = new PixiRendererAdapter();
    await Effect.runPromise(adapter.mount(document.createElement('div')));
    const controller = new EditorViewportController(adapter);
    controller.resize(640, 480);
    expect(resizeMock).toHaveBeenCalledWith(640, 480);
    await controller.dispose();
  });

  it('serializes disposal before the next mount can go live', async () => {
    const [{ EditorViewportController }, { PixiRendererAdapter }] = await Promise.all([
      import('./viewport/editor-viewport-controller.js'),
      import('@tileborne/runtime'),
    ]);
    let liveControllers = 0;

    const mountOne = async () => {
      await awaitViewportDisposeChain();
      const adapter = new PixiRendererAdapter();
      await Effect.runPromise(adapter.mount(document.createElement('div')));
      const controller = new EditorViewportController(adapter);
      liveControllers += 1;
      return controller;
    };

    const first = await mountOne();
    chainViewportDispose(async () => {
      await first.dispose();
      liveControllers -= 1;
    });
    await awaitViewportDisposeChain();
    expect(liveControllers).toBe(0);
    expect(disposeMock).toHaveBeenCalledTimes(1);

    const second = await mountOne();
    expect(liveControllers).toBe(1);
    chainViewportDispose(async () => {
      await second.dispose();
      liveControllers -= 1;
    });
    await awaitViewportDisposeChain();
    expect(liveControllers).toBe(0);
    expect(disposeMock).toHaveBeenCalledTimes(2);
  });

  it('startSerializedViewportMount waits for prior disposal before mounting', async () => {
    // This exercises the same helper the component uses. It proves that a
    // second mount cannot overlap a pending disposal of a previous mount.
    const events: string[] = [];

    let releaseFirstDispose: (() => void) | undefined;
    chainViewportDispose(
      () =>
        new Promise<void>((resolve) => {
          events.push('dispose:start');
          releaseFirstDispose = () => {
            events.push('dispose:end');
            resolve();
          };
        }),
    );

    const handle = startSerializedViewportMount<{ id: number }>({
      performMount: async () => {
        events.push('mount:perform');
        return { id: 1 };
      },
      disposePendingMount: async () => {
        events.push('mount:dispose-pending');
      },
      onMounted: () => {
        events.push('mount:onMounted');
      },
    });

    // Give microtasks a chance to run. `performMount` must NOT have started yet
    // because the dispose promise is still pending.
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['dispose:start']);

    releaseFirstDispose?.();
    await handle.settled;
    expect(events).toEqual(['dispose:start', 'dispose:end', 'mount:perform', 'mount:onMounted']);
  });

  it('startSerializedViewportMount disposes the adapter when cancelled mid-mount', async () => {
    let releaseMount: (() => void) | undefined;
    const events: string[] = [];

    const handle = startSerializedViewportMount<{ id: number }>({
      performMount: () =>
        new Promise((resolve) => {
          events.push('mount:perform');
          releaseMount = () => resolve({ id: 1 });
        }),
      disposePendingMount: async () => {
        events.push('mount:dispose-pending');
      },
      onMounted: () => {
        events.push('mount:onMounted');
      },
    });

    await Promise.resolve();
    expect(events).toEqual(['mount:perform']);

    handle.cancel();
    releaseMount?.();
    await handle.settled;

    expect(events).toContain('mount:dispose-pending');
    expect(events).not.toContain('mount:onMounted');
  });

  it('cancels in-flight mount when dispose runs before mount resolves', async () => {
    const { PixiRendererAdapter } = await import('@tileborne/runtime');
    let resolveMount: (() => void) | undefined;
    mountMock.mockReturnValueOnce(
      Effect.promise(
        () =>
          new Promise((resolve) => {
            resolveMount = () => resolve(undefined);
          }),
      ),
    );

    const adapter = new PixiRendererAdapter();
    let cancelled = false;
    let controller: { dispose: () => Promise<void> } | undefined;
    const mountPromise = Effect.runPromise(adapter.mount(document.createElement('div'))).then(
      async () => {
        if (cancelled) {
          await Effect.runPromise(adapter.dispose());
          return;
        }
        const { EditorViewportController } =
          await import('./viewport/editor-viewport-controller.js');
        controller = new EditorViewportController(adapter);
      },
    );

    cancelled = true;
    chainViewportDispose(async () => {
      if (controller) {
        await controller.dispose();
      } else {
        await Effect.runPromise(adapter.dispose());
      }
    });
    resolveMount?.();
    await mountPromise;
    await awaitViewportDisposeChain();
    expect(disposeMock).toHaveBeenCalled();
  });
});
