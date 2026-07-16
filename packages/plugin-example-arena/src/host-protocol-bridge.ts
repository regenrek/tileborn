import { Option } from 'effect';

import {
  ArenaWireError,
  decodeArenaClientMessage,
  decodeArenaServerMessage,
  encodeArenaServerMessage,
} from './wire-codec.js';

export interface RuntimeClientInputFrame {
  readonly tick: number;
  readonly seq: number;
  readonly dir?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly shoot: boolean;
  readonly aimDeg?: number;
}

export type RuntimeClientFrameView =
  | { readonly kind: 'heartbeat'; readonly tick: number }
  | { readonly kind: 'ack'; readonly tick: number; readonly receivedAtMs: number }
  | {
      readonly kind: 'input';
      readonly input: RuntimeClientInputFrame;
      readonly sortKey: {
        readonly tick: number;
        readonly seq: number;
      };
    };

export type RuntimeClientFrameDecodeResult =
  | { readonly kind: 'accepted'; readonly frame: RuntimeClientFrameView }
  | {
      readonly kind: 'rejected';
      readonly frame: Uint8Array;
      readonly closeCode: number;
      readonly closeReason: string;
    };

export const decodeHostClientFrameView = (
  bytes: Uint8Array,
): RuntimeClientFrameView | undefined => {
  const frame = decodeArenaClientMessage(bytes);
  if (frame._tag === 'ArenaHeartbeat') {
    return { kind: 'heartbeat', tick: frame.tick };
  }
  if (frame._tag === 'ArenaSnapshotAck') {
    return { kind: 'ack', tick: frame.tick, receivedAtMs: frame.receivedAtMs };
  }
  if (frame._tag === 'ArenaPlayerInput') {
    const input: RuntimeClientInputFrame = {
      tick: frame.tick,
      seq: frame.seq,
      ...(Option.isSome(frame.dir) ? { dir: frame.dir.value } : {}),
      shoot: frame.shoot,
      ...(Option.isSome(frame.aimDeg) ? { aimDeg: frame.aimDeg.value } : {}),
    };
    return {
      kind: 'input',
      input,
      sortKey: {
        tick: frame.tick,
        seq: frame.seq,
      },
    };
  }
  return undefined;
};

export const encodeInvalidClientFrame = (): Uint8Array =>
  encodeArenaServerMessage(
    new ArenaWireError({
      code: 'invalid_protocol_frame',
      message: 'invalid protocol frame',
    }),
  );

const rejectInvalidClientFrame = (): RuntimeClientFrameDecodeResult => ({
  kind: 'rejected',
  frame: encodeInvalidClientFrame(),
  closeCode: 1003,
  closeReason: 'invalid frame',
});

export const decodeHostClientFrame = (bytes: Uint8Array): RuntimeClientFrameDecodeResult => {
  try {
    const frame = decodeHostClientFrameView(bytes);
    return frame === undefined ? rejectInvalidClientFrame() : { kind: 'accepted', frame };
  } catch {
    return rejectInvalidClientFrame();
  }
};

export const isHostWelcomeFrame = (bytes: Uint8Array): boolean => {
  try {
    return decodeArenaServerMessage(bytes)._tag === 'ArenaSnapshot';
  } catch {
    return false;
  }
};
