/**
 * @deprecated Use SnapshotEntityStore for plugin-owned opaque snapshot frames.
 */
import { Option } from "effect";

import type { SnapshotDelta, SnapshotFull } from "./protocol.js";

type PlayerRecord = Record<string, unknown>;

/**
 * Applies SnapshotFull and SnapshotDelta messages in wire order.
 * docs/03-runtime-game-host.md §8.3: SnapshotDelta encodes only changed entities.
 */
export class SnapshotWorldState {
  private readonly players = new Map<number, PlayerRecord>();

  apply(message: SnapshotFull | SnapshotDelta): void {
    if (message._tag === "SnapshotFull") {
      this.players.clear();
      for (const player of Option.getOrElse(message.players, () => [])) {
        const entityId = Number((player as { readonly entityId: number }).entityId);
        this.players.set(entityId, { ...(player as PlayerRecord) });
      }
      return;
    }

    for (const change of Option.getOrElse(message.diff, () => [])) {
      const entityId = Number((change as { readonly entityId: number }).entityId);
      this.players.set(entityId, { ...(this.players.get(entityId) ?? {}), ...(change as PlayerRecord) });
    }
  }

  playerEntries(): readonly (readonly [number, PlayerRecord])[] {
    return [...this.players.entries()].sort(([left], [right]) => left - right);
  }
}
