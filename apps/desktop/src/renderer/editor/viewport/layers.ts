/** Stable zIndex order for editor render layers (bottom → top). */
export const EditorLayerZIndex = {
  tileChunks: 10,
  objectSprites: 20,
  gridOverlay: 25,
  collisionOverlay: 30,
  selectionOverlay: 40,
  brushPreview: 50,
  gizmos: 60,
  debugOverlay: 100,
} as const;
