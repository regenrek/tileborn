import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

const canvasErrors: string[] = [];
const originalConsoleError = console.error.bind(console);
let assertRendererHarnessErrors = false;

export const expectNoRendererHarnessErrorsForTest = (): void => {
  assertRendererHarnessErrors = true;
};

console.error = (...args: unknown[]): void => {
  const message = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
  if (
    message.includes('HTMLCanvasElement') ||
    message.includes('getContext') ||
    message.includes('failed to mount shipped runtime renderer') ||
    message.includes('failed to render shipped runtime entities')
  ) {
    canvasErrors.push(message);
    return;
  }
  originalConsoleError(...args);
};

const context2d = {
  canvas: null as HTMLCanvasElement | null,
  clearRect: () => undefined,
  drawImage: () => undefined,
  fillRect: () => undefined,
  getImageData: (_x: number, _y: number, width: number, height: number) => ({
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  }),
  measureText: (text: string) => ({ width: text.length * 8 }),
  putImageData: () => undefined,
  resetTransform: () => undefined,
  restore: () => undefined,
  save: () => undefined,
  scale: () => undefined,
  setTransform: () => undefined,
  transform: () => undefined,
  translate: () => undefined,
};

const webglContext = {
  canvas: null as HTMLCanvasElement | null,
  getContextAttributes: () => ({}),
  getExtension: () => null,
  getParameter: () => 0,
  isContextLost: () => false,
};

const originalGetContext = HTMLCanvasElement.prototype.getContext;
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: function getContext(this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
    if (contextId === '2d') {
      context2d.canvas = this;
      return context2d as unknown as CanvasRenderingContext2D;
    }
    if (contextId === 'webgl' || contextId === 'webgl2') {
      webglContext.canvas = this;
      return webglContext as unknown as WebGLRenderingContext;
    }
    return (originalGetContext as unknown as (...input: unknown[]) => RenderingContext | null).call(
      this,
      contextId,
      ...args,
    );
  },
});

class TestImage extends EventTarget {
  onerror: ((this: GlobalEventHandlers, ev: Event) => unknown) | null = null;
  onload: ((this: GlobalEventHandlers, ev: Event) => unknown) | null = null;
  width = 48;
  height = 48;
  naturalWidth = 48;
  naturalHeight = 48;
  complete = false;
  private currentSrc = '';

  get src(): string {
    return this.currentSrc;
  }

  set src(value: string) {
    this.currentSrc = value;
    queueMicrotask(() => {
      this.complete = true;
      this.onload?.call(this as unknown as GlobalEventHandlers, new Event('load'));
      this.dispatchEvent(new Event('load'));
    });
  }

  decode(): Promise<void> {
    return Promise.resolve();
  }
}

Object.defineProperty(globalThis, 'Image', {
  configurable: true,
  value: TestImage,
});

class TestImageBitmap {
  readonly width = 48;
  readonly height = 48;

  close(): void {
    return undefined;
  }
}

Object.defineProperty(globalThis, 'ImageBitmap', {
  configurable: true,
  value: TestImageBitmap,
});

Object.defineProperty(globalThis, 'createImageBitmap', {
  configurable: true,
  value: () => Promise.resolve(new TestImageBitmap()),
});

afterEach(() => {
  cleanup();
  if (assertRendererHarnessErrors) {
    expect(canvasErrors).toEqual([]);
  }
  assertRendererHarnessErrors = false;
  canvasErrors.length = 0;
});
