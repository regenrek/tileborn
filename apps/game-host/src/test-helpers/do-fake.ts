export interface FakeWebSocketLike {
  readonly readyState: number;
  send(data: ArrayBuffer | string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

export interface FakeDurableObjectState {
  readonly storageMap: Map<string, unknown>;
  readonly sockets: FakeWebSocketLike[];
  readonly alarmHandlers: Array<() => Promise<void>>;
  readonly storage: DurableObjectStorage;
  acceptWebSocket(ws: WebSocket): void;
  getWebSockets(): WebSocket[];
  waitUntil(promise: Promise<unknown>): void;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  triggerAlarm(): Promise<void>;
  advanceTime(ms: number): Promise<void>;
}

const OPEN = 1;

export class MemoryWebSocket implements FakeWebSocketLike {
  readyState = OPEN;
  private attachment: unknown;

  readonly sent: ArrayBuffer[] = [];
  closeCode: number | null = null;
  closeReason = '';

  binaryType: BinaryType = 'arraybuffer';
  bufferedAmount = 0;
  extensions = '';
  protocol = '';
  url = '';
  onclose: ((this: WebSocket, ev: CloseEvent) => void) | null = null;
  onerror: ((this: WebSocket, ev: Event) => void) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => void) | null = null;
  onopen: ((this: WebSocket, ev: Event) => void) | null = null;

  send(data: ArrayBuffer | string): void {
    if (typeof data === 'string') {
      this.sent.push(new TextEncoder().encode(data).buffer);
      return;
    }
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = WebSocket.CLOSED;
    this.closeCode = code;
    this.closeReason = reason;
  }

  serializeAttachment(value: unknown): void {
    this.attachment = value;
  }

  deserializeAttachment(): unknown {
    return this.attachment;
  }

  addEventListener(): void {
    return;
  }

  removeEventListener(): void {
    return;
  }

  dispatchEvent(): boolean {
    return true;
  }
}

export const asDurableObjectState = (state: FakeDurableObjectState): DurableObjectState =>
  state as DurableObjectState;

export const createFakeDurableObjectState = (): FakeDurableObjectState => {
  const storageMap = new Map<string, unknown>();
  const sockets: FakeWebSocketLike[] = [];
  const alarmHandlers: Array<() => Promise<void>> = [];
  let alarmAt: number | null = null;
  let nowMs = Date.now();

  const state: FakeDurableObjectState = {
    storageMap,
    sockets,
    alarmHandlers,
    storage: {
      get: async <T>(key: string) => storageMap.get(key) as T | undefined,
      put: async (key: string, value: unknown) => {
        storageMap.set(key, value);
      },
      delete: async (key: string) => {
        storageMap.delete(key);
      },
      list: async () => ({
        keys: [...storageMap.keys()].map((name) => ({ name })),
        cursor: '',
        list_complete: true,
      }),
      setAlarm: async (scheduledTime: number | Date) => {
        alarmAt = typeof scheduledTime === 'number' ? scheduledTime : scheduledTime.getTime();
      },
      getAlarm: async () => alarmAt,
      deleteAlarm: async () => {
        alarmAt = null;
      },
    },
    acceptWebSocket: (ws: WebSocket) => {
      sockets.push(ws as MemoryWebSocket);
    },
    getWebSockets: () => sockets as MemoryWebSocket[] as WebSocket[],
    waitUntil: (promise: Promise<unknown>) => {
      void promise;
    },
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
    triggerAlarm: async () => {
      for (const handler of alarmHandlers) {
        await handler();
      }
    },
    advanceTime: async (ms: number) => {
      nowMs += ms;
      if (alarmAt !== null && nowMs >= alarmAt) {
        alarmAt = null;
        await state.triggerAlarm();
      }
    },
  };

  return state;
};

export const registerAlarmHandler = (
  state: FakeDurableObjectState,
  handler: () => Promise<void>,
): void => {
  state.alarmHandlers.push(handler);
};

export const createWebSocketPair = (): { client: MemoryWebSocket; server: MemoryWebSocket } => {
  const client = new MemoryWebSocket();
  const server = new MemoryWebSocket();
  return { client, server };
};

interface GlobalWorkerPolyfills {
  WebSocketPair?: typeof WebSocketPair;
}

export const installWorkerGlobals = (): void => {
  const globalScope = globalThis as GlobalWorkerPolyfills;
  if (globalScope.WebSocketPair) {
    return;
  }
  class PolyfillWebSocketPair {
    readonly 0: WebSocket;
    readonly 1: WebSocket;

    constructor() {
      const pair = createWebSocketPair();
      this[0] = pair.client;
      this[1] = pair.server;
    }
  }
  globalScope.WebSocketPair = PolyfillWebSocketPair as typeof WebSocketPair;
};
