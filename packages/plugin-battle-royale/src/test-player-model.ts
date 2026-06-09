import {
  AssetLibraryReference,
  PlayerModelClipSet,
  PlayerModelRef,
  makeClipId,
  makePackId,
} from "@tileborne/core";

export const testPlayerModel = (id = "model:test-player"): PlayerModelRef => {
  const clipIdAt = (index: number) =>
    makeClipId(`550e8400-e29b-41d4-a716-44665544${String(index).padStart(4, "0")}`);
  return new PlayerModelRef({
    id,
    label: id,
    ref: new AssetLibraryReference({
      packId: makePackId("550e8400-e29b-41d4-a716-446655449999"),
      kind: "sprite",
      refId: "placeable:test-player",
      clipId: clipIdAt(0),
    }),
    defaultClipId: clipIdAt(0),
    clips: new PlayerModelClipSet({
      idle: clipIdAt(0),
      walk: clipIdAt(1),
      run: clipIdAt(2),
      shoot: clipIdAt(3),
      reload: clipIdAt(4),
      hit: clipIdAt(5),
      death: clipIdAt(6),
      dash: clipIdAt(7),
      pickup: clipIdAt(8),
    }),
    anchor: { x: 0.5, y: 1 },
    hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
    muzzle: { x: 0.75, y: 0.45 },
  });
};

export const TEST_PLAYER_MODELS = [testPlayerModel()] as const;
