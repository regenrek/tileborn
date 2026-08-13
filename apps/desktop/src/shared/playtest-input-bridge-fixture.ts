export type PlaytestInputBridgePayload = {
  readonly sessionId: string;
  readonly playerId: string;
  readonly tick: number;
  readonly seq: number;
  readonly dir?: 0;
  readonly shoot: boolean;
  readonly reload: boolean;
  readonly interact: boolean;
  readonly drop: boolean;
  readonly abilities: readonly string[];
  readonly aimDeg: number;
  readonly swapSlot?: number;
};

export const pointerMoveDigit3RafBridgePayloads = (
  sessionId: string,
  tick: number,
): readonly PlaytestInputBridgePayload[] => [
  {
    sessionId,
    playerId: 'player-1',
    tick,
    seq: 1,
    shoot: false,
    reload: false,
    interact: false,
    drop: false,
    abilities: [],
    aimDeg: 90,
    swapSlot: 3,
  },
  {
    sessionId,
    playerId: 'player-1',
    tick,
    seq: 2,
    shoot: false,
    reload: false,
    interact: false,
    drop: false,
    abilities: [],
    aimDeg: 90,
  },
];
