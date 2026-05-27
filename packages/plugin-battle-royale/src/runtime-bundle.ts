export { createRuntimeAdapter } from "./runtime-adapter.js";
export {
  decodeHostClientFrame as decodeClientFrame,
  decodeHostClientFrameView as decodeClientFrameView,
  encodeInvalidClientFrame,
  isHostWelcomeFrame as isWelcomeFrame,
} from "./host-protocol-bridge.js";
export type {
  RuntimeClientFrameDecodeResult,
  RuntimeClientFrameView,
  RuntimeClientInputFrame,
} from "./host-protocol-bridge.js";
