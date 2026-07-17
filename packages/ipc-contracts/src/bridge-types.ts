import type { TileborneBridgeOf } from './codegen-shape.js';
import type { MainEventRegistry } from './events.js';
import type { MainIpcRegistry } from './contracts/main-registry.js';

export type MainTileborneBridge = TileborneBridgeOf<MainIpcRegistry, MainEventRegistry>;
