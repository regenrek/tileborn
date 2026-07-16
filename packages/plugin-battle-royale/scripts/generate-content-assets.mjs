import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'assets', 'core');
const atlasDir = path.join(outDir, 'atlases');
const playerAtlasDir = path.join(atlasDir, 'player-models');
const weaponAtlasDir = path.join(atlasDir, 'weapons');
const petwarsWeaponDir = path.resolve(
  root,
  '..',
  '..',
  '..',
  'games',
  'petwars',
  'app',
  'public',
  'assets',
  'graphics',
  'weapons',
);
const petwarsUprightMaltipooDir = path.resolve(
  root,
  '..',
  '..',
  '..',
  'games',
  'petwars',
  'docs',
  'goals',
  'maltipoo-player-sprites-production',
  'notes',
  'hatch-pet-upright',
);

const OBJECT_FRAME = 48;
const PET_FRAME = { width: 192, height: 208 };
const PET_ATLAS = {
  width: 1536,
  height: 1872,
  frameWidth: PET_FRAME.width,
  frameHeight: PET_FRAME.height,
  columns: 8,
  rows: 9,
};
const CLIPS = ['idle', 'walk', 'run', 'shoot', 'reload', 'hit', 'death', 'dash', 'pickup'];
const NON_LOOPING_CLIPS = new Set(['shoot', 'reload', 'hit', 'death', 'dash', 'pickup']);

const clipRows = {
  idle: { sourceState: 'idle', row: 0, frames: [0, 1, 2, 3, 4, 5], durationMs: 130 },
  walk: { sourceState: 'running', row: 7, frames: [0, 1, 2, 3, 4, 5], durationMs: 100 },
  run: { sourceState: 'running', row: 7, frames: [0, 1, 2, 3, 4, 5], durationMs: 80 },
  shoot: {
    sourceState: 'review',
    row: 8,
    frames: [0, 1, 2, 3, 4, 5],
    durationMs: 70,
    fallbackNote:
      'Codex-pet Maltipoo atlas has no gun-fire row; BR weapon overlay and muzzle flash own shooting.',
  },
  reload: {
    sourceState: 'waiting',
    row: 6,
    frames: [0, 1, 2, 3, 4, 5],
    durationMs: 120,
    fallbackNote:
      'Codex-pet Maltipoo atlas has no reload row; waiting loop is the visible reload fallback.',
  },
  hit: { sourceState: 'failed', row: 5, frames: [0, 1, 2, 3], durationMs: 110 },
  death: { sourceState: 'failed', row: 5, frames: [0, 1, 2, 3, 4, 5, 6, 7], durationMs: 130 },
  dash: { sourceState: 'jumping', row: 4, frames: [0, 1, 2, 3, 4], durationMs: 80 },
  pickup: { sourceState: 'waving', row: 3, frames: [0, 1, 2, 3], durationMs: 100 },
};

const PLAYER_MODELS = [
  {
    id: 'maltipoo-mae',
    label: 'Maltipoo Mae',
    variant: 'female',
    assetIdNumber: 0x0002,
    placeableNumber: 0x2000,
    clipBase: 0x1000,
    tileBase: 0x3000,
    upstreamSourcePath: path.join(
      petwarsUprightMaltipooDir,
      'maltipoo-mae',
      'final',
      'spritesheet.png',
    ),
    upstreamValidationPath: path.join(
      petwarsUprightMaltipooDir,
      'maltipoo-mae',
      'final',
      'validation.json',
    ),
    sourcePath: 'sources/player-models/maltipoo-mae/spritesheet.png',
    atlasPath: 'atlases/player-models/maltipoo-mae.png',
    contactSheetPath: 'sources/player-models/maltipoo-mae/contact-sheet.png',
    validationPath: 'sources/player-models/maltipoo-mae/validation.json',
    requestPath: 'sources/player-models/maltipoo-mae/pet_request.json',
  },
  {
    id: 'maltipoo-max',
    label: 'Maltipoo Max',
    variant: 'male',
    assetIdNumber: 0x0004,
    placeableNumber: 0x2001,
    clipBase: 0x1100,
    tileBase: 0x4000,
    upstreamSourcePath: path.join(
      petwarsUprightMaltipooDir,
      'maltipoo-max',
      'final',
      'spritesheet.png',
    ),
    upstreamValidationPath: path.join(
      petwarsUprightMaltipooDir,
      'maltipoo-max',
      'final',
      'validation.json',
    ),
    sourcePath: 'sources/player-models/maltipoo-max/spritesheet.png',
    atlasPath: 'atlases/player-models/maltipoo-max.png',
    contactSheetPath: 'sources/player-models/maltipoo-max/contact-sheet.png',
    validationPath: 'sources/player-models/maltipoo-max/validation.json',
    requestPath: 'sources/player-models/maltipoo-max/pet_request.json',
  },
];
const OBJECTS = [
  { key: 'spawn-marker', label: 'Spawn Marker', color: [74, 222, 128] },
  { key: 'shrink-anchor', label: 'Shrink Anchor', color: [96, 165, 250] },
  { key: 'loot-crate', label: 'Loot Crate', color: [249, 115, 22] },
  { key: 'trap', label: 'Trap', color: [245, 158, 11] },
  { key: 'decoy', label: 'Decoy', color: [34, 211, 238] },
  { key: 'barrier', label: 'Barrier', color: [148, 163, 184] },
  { key: 'health-pack', label: 'Health Pack', color: [239, 68, 68] },
  { key: 'ammo-box', label: 'Ammo Box', color: [250, 204, 21] },
  { key: 'armor-vest', label: 'Armor Vest', color: [59, 130, 246] },
  { key: 'rifle', label: 'Rifle', color: [31, 41, 55] },
  { key: 'projectile-bolt', label: 'Projectile Bolt', color: [147, 197, 253] },
  { key: 'muzzle-flash', label: 'Muzzle Flash', color: [250, 204, 21] },
  { key: 'impact-burst', label: 'Impact Burst', color: [254, 240, 138] },
  { key: 'shield-bubble', label: 'Shield Bubble', color: [56, 189, 248] },
  { key: 'player-shadow', label: 'Player Shadow', color: [15, 23, 42] },
  { key: 'hazard-flame', label: 'Hazard Flame', color: [249, 115, 22] },
];

const WEAPON_ASSET_BASE = 0x0100;
const WEAPON_PLACEABLE_BASE = 0x7000;
const WEAPON_TILE_BASE = 0x8000;
const DEFAULT_WEAPON_VISUAL_PROFILE = {
  scale: 0.52,
  pivot: { x: 0.28, y: 0.56 },
  hand: { x: 0.28, y: 0.56 },
  muzzle: { x: 0.92, y: 0.5 },
};

const WEAPON_VISUAL_PROFILES = {
  'ion-blaster': { muzzle: { x: 0.9, y: 0.48 } },
  'pulse-ranger': { muzzle: { x: 0.93, y: 0.47 } },
  'arc-burst': { muzzle: { x: 0.9, y: 0.5 } },
  'pulse-carbine': { muzzle: { x: 0.92, y: 0.49 } },
  'scatter-lance': { muzzle: { x: 0.91, y: 0.52 } },
  'arc-charger': { muzzle: { x: 0.88, y: 0.51 } },
  'ricochet-disc': { hand: { x: 0.36, y: 0.55 }, muzzle: { x: 0.78, y: 0.5 } },
  'rail-needle': { muzzle: { x: 0.96, y: 0.48 } },
  'nova-launcher': { hand: { x: 0.25, y: 0.58 }, muzzle: { x: 0.92, y: 0.5 } },
  'prism-beam': { muzzle: { x: 0.94, y: 0.5 } },
  'plasma-sabre': { hand: { x: 0.23, y: 0.6 }, muzzle: { x: 0.86, y: 0.45 } },
};

const weaponVisualProfile = (slug) => {
  const override = WEAPON_VISUAL_PROFILES[slug] ?? {};
  return {
    scale: override.scale ?? DEFAULT_WEAPON_VISUAL_PROFILE.scale,
    pivot: override.pivot ?? DEFAULT_WEAPON_VISUAL_PROFILE.pivot,
    hand: override.hand ?? DEFAULT_WEAPON_VISUAL_PROFILE.hand,
    muzzle: override.muzzle ?? DEFAULT_WEAPON_VISUAL_PROFILE.muzzle,
  };
};

const slugLabel = (slug) =>
  slug
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');

const readPetwarsWeapons = async () => {
  const manifestPath = path.join(petwarsWeaponDir, 'manifest.json');
  const raw = JSON.parse(await readFile(manifestPath, 'utf8'));
  return raw.weapons.map((weapon) => ({
    ...weapon,
    label: slugLabel(weapon.slug),
    sourcePath: path.join(petwarsWeaponDir, weapon.file),
    atlasPath: `atlases/weapons/${weapon.file}`,
  }));
};

const ids = {
  pack: 'pack:b4111e00-0000-4000-8000-000000000001',
  objectsAsset: 'asset:b4111e00-0000-4000-8000-000000000003',
};

const uuid = (n) => `b4111e00-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const id = (prefix, n) => `${prefix}:${uuid(n)}`;
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const makeCanvas = (width, height) => ({ width, height, data: new Uint8Array(width * height * 4) });

const setPixel = (canvas, x, y, rgba) => {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const index = (y * canvas.width + x) * 4;
  canvas.data[index] = rgba[0];
  canvas.data[index + 1] = rgba[1];
  canvas.data[index + 2] = rgba[2];
  canvas.data[index + 3] = rgba[3] ?? 255;
};

const fillRect = (canvas, x, y, w, h, rgba) => {
  for (let yy = Math.round(y); yy < Math.round(y + h); yy += 1) {
    for (let xx = Math.round(x); xx < Math.round(x + w); xx += 1) setPixel(canvas, xx, yy, rgba);
  }
};

const fillEllipse = (canvas, cx, cy, rx, ry, rgba) => {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPixel(canvas, x, y, rgba);
    }
  }
};

const strokeRect = (canvas, x, y, w, h, rgba) => {
  fillRect(canvas, x, y, w, 2, rgba);
  fillRect(canvas, x, y + h - 2, w, 2, rgba);
  fillRect(canvas, x, y, 2, h, rgba);
  fillRect(canvas, x + w - 2, y, 2, h, rgba);
};

const line = (canvas, x0, y0, x1, y1, rgba) => {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    setPixel(canvas, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), rgba);
  }
};

const drawObjectFrame = (canvas, index, object) => {
  const ox = index * OBJECT_FRAME;
  const oy = 0;
  const cx = ox + 24;
  const color = object.color;
  fillEllipse(canvas, cx, oy + 40, 13, 4, [0, 0, 0, 70]);
  if (object.key === 'spawn-marker') {
    fillRect(canvas, cx - 3, oy + 11, 6, 25, [...color, 255]);
    fillEllipse(canvas, cx, oy + 10, 10, 4, [...color, 220]);
    line(canvas, cx - 11, oy + 10, cx + 11, oy + 10, [20, 83, 45, 255]);
  } else if (object.key === 'shrink-anchor') {
    fillEllipse(canvas, cx, oy + 24, 16, 16, [...color, 70]);
    strokeRect(canvas, cx - 9, oy + 14, 18, 20, [...color, 255]);
    line(canvas, cx, oy + 8, cx, oy + 38, [...color, 255]);
    line(canvas, cx - 14, oy + 24, cx + 14, oy + 24, [...color, 255]);
  } else if (object.key === 'loot-crate') {
    fillRect(canvas, ox + 10, oy + 14, 28, 26, [...color, 255]);
    strokeRect(canvas, ox + 10, oy + 14, 28, 26, [124, 45, 18, 255]);
    line(canvas, ox + 12, oy + 16, ox + 36, oy + 38, [124, 45, 18, 255]);
    line(canvas, ox + 36, oy + 16, ox + 12, oy + 38, [124, 45, 18, 255]);
  } else if (object.key === 'trap') {
    fillEllipse(canvas, cx, oy + 26, 16, 13, [...color, 220]);
    line(canvas, cx - 14, oy + 20, cx + 14, oy + 32, [80, 44, 0, 255]);
    line(canvas, cx + 14, oy + 20, cx - 14, oy + 32, [80, 44, 0, 255]);
  } else if (object.key === 'decoy') {
    fillEllipse(canvas, cx, oy + 24, 13, 15, [...color, 150]);
    fillEllipse(canvas, cx, oy + 24, 6, 8, [15, 23, 42, 220]);
  } else if (object.key === 'barrier') {
    fillRect(canvas, ox + 8, oy + 14, 32, 24, [...color, 255]);
    strokeRect(canvas, ox + 8, oy + 14, 32, 24, [51, 65, 85, 255]);
    fillRect(canvas, ox + 10, oy + 22, 28, 4, [226, 232, 240, 255]);
  } else if (object.key === 'rifle') {
    fillRect(canvas, ox + 8, oy + 23, 34, 5, [...color, 255]);
    fillRect(canvas, ox + 14, oy + 28, 9, 8, [...color, 255]);
    fillRect(canvas, ox + 35, oy + 21, 5, 9, [15, 23, 42, 255]);
    fillRect(canvas, ox + 39, oy + 24, 5, 2, [148, 163, 184, 255]);
  } else if (object.key === 'projectile-bolt') {
    fillRect(canvas, ox + 15, oy + 22, 26, 4, [...color, 255]);
    fillRect(canvas, ox + 40, oy + 23, 4, 2, [248, 250, 252, 255]);
    line(canvas, ox + 8, oy + 24, ox + 15, oy + 24, [59, 130, 246, 170]);
    line(canvas, ox + 5, oy + 26, ox + 18, oy + 26, [96, 165, 250, 80]);
  } else if (object.key === 'muzzle-flash') {
    fillEllipse(canvas, cx + 5, oy + 24, 10, 6, [...color, 230]);
    line(canvas, cx - 6, oy + 24, cx + 18, oy + 14, [254, 240, 138, 255]);
    line(canvas, cx - 6, oy + 24, cx + 20, oy + 24, [254, 240, 138, 255]);
    line(canvas, cx - 6, oy + 24, cx + 18, oy + 34, [249, 115, 22, 255]);
    fillEllipse(canvas, cx + 2, oy + 24, 4, 3, [255, 255, 255, 255]);
  } else if (object.key === 'impact-burst') {
    fillEllipse(canvas, cx, oy + 24, 6, 6, [...color, 210]);
    line(canvas, cx - 17, oy + 24, cx + 17, oy + 24, [253, 186, 116, 255]);
    line(canvas, cx, oy + 9, cx, oy + 39, [253, 186, 116, 255]);
    line(canvas, cx - 12, oy + 12, cx + 12, oy + 36, [254, 240, 138, 255]);
    line(canvas, cx + 12, oy + 12, cx - 12, oy + 36, [254, 240, 138, 255]);
  } else if (object.key === 'shield-bubble') {
    fillEllipse(canvas, cx, oy + 24, 18, 18, [...color, 60]);
    fillEllipse(canvas, cx, oy + 24, 14, 14, [...color, 35]);
    line(canvas, cx - 16, oy + 24, cx + 16, oy + 24, [...color, 210]);
    line(canvas, cx, oy + 8, cx, oy + 40, [...color, 210]);
    fillEllipse(canvas, cx, oy + 24, 4, 4, [224, 242, 254, 220]);
  } else if (object.key === 'player-shadow') {
    fillEllipse(canvas, cx, oy + 28, 18, 8, [...color, 120]);
    fillEllipse(canvas, cx, oy + 28, 12, 5, [2, 6, 23, 150]);
  } else if (object.key === 'hazard-flame') {
    fillEllipse(canvas, cx - 7, oy + 28, 10, 14, [249, 115, 22, 205]);
    fillEllipse(canvas, cx + 6, oy + 27, 10, 16, [239, 68, 68, 190]);
    fillEllipse(canvas, cx, oy + 22, 8, 16, [250, 204, 21, 220]);
    fillEllipse(canvas, cx, oy + 30, 5, 8, [254, 240, 138, 230]);
  } else {
    fillRect(canvas, ox + 12, oy + 16, 24, 22, [...color, 255]);
    strokeRect(canvas, ox + 12, oy + 16, 24, 22, [30, 41, 59, 255]);
    fillRect(canvas, cx - 2, oy + 20, 4, 14, [255, 255, 255, 240]);
    fillRect(canvas, cx - 7, oy + 25, 14, 4, [255, 255, 255, 240]);
  }
};

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, payload) => {
  const typeBytes = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  typeBytes.copy(out, 4);
  payload.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 8 + payload.length);
  return out;
};

const png = (canvas) => {
  const raw = Buffer.alloc((canvas.width * 4 + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    const row = y * (canvas.width * 4 + 1);
    raw[row] = 0;
    Buffer.from(canvas.data.subarray(y * canvas.width * 4, (y + 1) * canvas.width * 4)).copy(
      raw,
      row + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const assetLicense = {
  spdxId: 'MIT',
  attribution: 'Tileborne / Petwars generated Maltipoo assets',
  notes:
    'Maltipoo player sprites are reused from Petwars upright hatch-pet exports by Kevin Kern; BR object sprites are generated in-repo.',
  redistributable: true,
};

const objectAssetLicense = {
  spdxId: 'MIT',
  attribution: 'Tileborne',
  notes:
    'Programmatically generated Battle Royale pixel-art object content; no third-party source assets.',
  redistributable: true,
};

const weaponAssetLicense = {
  spdxId: 'MIT',
  attribution: 'Tileborne / Petwars generated weapon assets',
  notes:
    'Petwars default weapon sprites generated for Kevin Kern and imported from app/public/assets/graphics/weapons.',
  redistributable: true,
};

const assetIdForModel = (model) => id('asset', model.assetIdNumber);

const playerFrameRef = (model, clipName, frameIndex, durationMs) => {
  const clip = clipRows[clipName];
  const column = clip.frames[frameIndex];
  return {
    assetId: assetIdForModel(model),
    tileId: id('tile', model.tileBase + CLIPS.indexOf(clipName) * 0x100 + frameIndex),
    uv: {
      x: column * PET_FRAME.width,
      y: clip.row * PET_FRAME.height,
      w: PET_FRAME.width,
      h: PET_FRAME.height,
    },
    durationMs,
  };
};

const objectFrameRef = (assetId, tileBase, x, y, durationMs = 120) => ({
  assetId,
  tileId: id('tile', tileBase),
  uv: { x, y, w: OBJECT_FRAME, h: OBJECT_FRAME },
  durationMs,
});

const weaponFrameRef = (weapon, index) => ({
  assetId: id('asset', WEAPON_ASSET_BASE + index),
  tileId: id('tile', WEAPON_TILE_BASE + index),
  uv: { x: 0, y: 0, w: weapon.width, h: weapon.height },
  durationMs: 120,
});

const buildPlayerPlaceables = () =>
  PLAYER_MODELS.map((model, modelIndex) => {
    const clips = CLIPS.map((clipName, clipIndex) => {
      const clip = clipRows[clipName];
      return {
        id: id('clip', model.clipBase + clipIndex),
        name: clipName,
        frames: clip.frames.map((_column, frameIndex) =>
          playerFrameRef(model, clipName, frameIndex, clip.durationMs),
        ),
        loop: !NON_LOOPING_CLIPS.has(clipName),
        defaultDurationMs: clip.durationMs,
      };
    });
    return {
      id: id('placeable', model.placeableNumber),
      name: model.label,
      size: { width: PET_FRAME.width, height: PET_FRAME.height },
      frames: [clips[0].frames[0]],
      clips,
      tags: ['sprite', 'player-model', 'battle-royale', 'maltipoo', model.id],
      placementMode: 'object',
      source: {
        format: 'tiled',
        tilesetName: 'Battle Royale Maltipoo Player Models',
        localTileId: modelIndex,
        image: model.atlasPath,
        imageWidth: PET_ATLAS.width,
        imageHeight: PET_ATLAS.height,
        objectType: 'player-model',
        objectClass: 'battle-royale-player',
        properties: {
          modelId: model.id,
          assetFormat: 'codex_pet',
          variant: model.variant,
          sourcePath: model.sourcePath,
          contactSheetPath: model.contactSheetPath,
          validationPath: model.validationPath,
          requestPath: model.requestPath,
          clipSourceRows: Object.fromEntries(
            CLIPS.map((clipName) => [
              clipName,
              {
                sourceState: clipRows[clipName].sourceState,
                row: clipRows[clipName].row,
                frames: clipRows[clipName].frames,
                ...(clipRows[clipName].fallbackNote === undefined
                  ? {}
                  : { fallbackNote: clipRows[clipName].fallbackNote }),
              },
            ]),
          ),
        },
      },
    };
  });

const buildObjectPlaceables = () =>
  OBJECTS.map((object, index) => ({
    id: id('placeable', 0x5000 + index),
    name: object.label,
    size: { width: OBJECT_FRAME, height: OBJECT_FRAME },
    frames: [objectFrameRef(ids.objectsAsset, 0x6000 + index, index * OBJECT_FRAME, 0, 120)],
    tags: ['battle-royale', object.key],
    placementMode: 'object',
    source: {
      format: 'tiled',
      tilesetName: 'Battle Royale Objects',
      localTileId: index,
      image: 'atlases/objects.png',
      imageWidth: OBJECT_FRAME,
      imageHeight: OBJECT_FRAME,
      objectType: object.key,
      objectClass: 'battle-royale-object',
      properties: {},
    },
  }));

const buildWeaponPlaceables = (weapons) =>
  weapons.map((weapon, index) => {
    const visual = weaponVisualProfile(weapon.slug);
    return {
      id: id('placeable', WEAPON_PLACEABLE_BASE + index),
      name: weapon.label,
      size: { width: weapon.width, height: weapon.height },
      frames: [weaponFrameRef(weapon, index)],
      tags: ['battle-royale', 'weapon', 'petwars', weapon.kind, weapon.slug],
      placementMode: 'object',
      source: {
        format: 'tiled',
        tilesetName: 'Petwars Weapon Sprites',
        localTileId: index,
        image: weapon.atlasPath,
        imageWidth: weapon.width,
        imageHeight: weapon.height,
        objectType: 'weapon',
        objectClass: 'battle-royale-weapon',
        properties: {
          sourceGame: 'petwars',
          weaponSlug: weapon.slug,
          weaponKind: weapon.kind,
          sourcePath: `../games/petwars/app/public/assets/graphics/weapons/${weapon.file}`,
          'tileborne.visual.scale': visual.scale,
          'tileborne.visual.pivotX': visual.pivot.x,
          'tileborne.visual.pivotY': visual.pivot.y,
          'tileborne.visual.handX': visual.hand.x,
          'tileborne.visual.handY': visual.hand.y,
          'tileborne.visual.muzzleX': visual.muzzle.x,
          'tileborne.visual.muzzleY': visual.muzzle.y,
        },
      },
    };
  });

const copyPlayerAtlases = async () => {
  const assets = [];
  for (const model of PLAYER_MODELS) {
    const sourcePath = path.join(outDir, model.sourcePath);
    await copyFile(model.upstreamSourcePath, sourcePath);
    await copyFile(model.upstreamValidationPath, path.join(outDir, model.validationPath));
    const atlasPath = path.join(outDir, model.atlasPath);
    await copyFile(sourcePath, atlasPath);
    const bytes = await readFile(atlasPath);
    assets.push({
      id: assetIdForModel(model),
      path: model.atlasPath,
      mime: 'image/png',
      size: bytes.byteLength,
      hash: sha256(bytes),
      license: assetLicense,
    });
  }
  return assets;
};

const copyWeaponAtlases = async (weapons) => {
  const assets = [];
  await mkdir(weaponAtlasDir, { recursive: true });
  for (const [index, weapon] of weapons.entries()) {
    const atlasPath = path.join(outDir, weapon.atlasPath);
    await copyFile(weapon.sourcePath, atlasPath);
    const bytes = await readFile(atlasPath);
    assets.push({
      id: id('asset', WEAPON_ASSET_BASE + index),
      path: weapon.atlasPath,
      mime: 'image/png',
      size: bytes.byteLength,
      hash: sha256(bytes),
      license: weaponAssetLicense,
    });
  }
  return assets;
};

const main = async () => {
  await mkdir(playerAtlasDir, { recursive: true });
  const petwarsWeapons = await readPetwarsWeapons();
  const playerAssets = await copyPlayerAtlases();
  const weaponAssets = await copyWeaponAtlases(petwarsWeapons);

  const objectCanvas = makeCanvas(OBJECT_FRAME * OBJECTS.length, OBJECT_FRAME);
  OBJECTS.forEach((object, index) => drawObjectFrame(objectCanvas, index, object));
  const objectsPng = png(objectCanvas);
  await writeFile(path.join(atlasDir, 'objects.png'), objectsPng);

  const manifest = {
    schemaVersion: 1,
    id: ids.pack,
    name: 'Battle Royale Core Assets',
    version: '0.1.0',
    license: assetLicense,
    assets: [
      ...playerAssets,
      ...weaponAssets,
      {
        id: ids.objectsAsset,
        path: 'atlases/objects.png',
        mime: 'image/png',
        size: objectsPng.byteLength,
        hash: sha256(objectsPng),
        license: objectAssetLicense,
      },
    ],
    provenance: {
      sourcePath: 'packages/plugin-battle-royale/scripts/generate-content-assets.mjs',
      originTool: 'tileborne-br-content-generator',
      importedAt: '2026-06-08T00:00:00.000Z',
      sourceAssets: PLAYER_MODELS.map((model) => ({
        modelId: model.id,
        atlas: model.sourcePath,
        contactSheet: model.contactSheetPath,
        validation: model.validationPath,
        petRequest: model.requestPath,
      })),
      petwarsWeapons: petwarsWeapons.map((weapon) => ({
        slug: weapon.slug,
        kind: weapon.kind,
        source: `../games/petwars/app/public/assets/graphics/weapons/${weapon.file}`,
        atlas: weapon.atlasPath,
      })),
    },
    terrainClasses: [],
    tilesets: [],
    tiles: [],
    autotileRules: [],
    variantFilters: [],
    animations: [],
    terrainTransitions: [],
    collisionMasks: [],
    placeables: [
      ...buildPlayerPlaceables(),
      ...buildObjectPlaceables(),
      ...buildWeaponPlaceables(petwarsWeapons),
    ],
  };

  await writeFile(
    path.join(outDir, 'tileborne-asset-pack.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(outDir, 'PROVENANCE.md'),
    [
      '# Battle Royale Core Assets',
      '',
      '- License: MIT, under the repository root LICENSE.',
      '- Player model source: Petwars Maltipoo Mae and Maltipoo Max upright hatch-pet exports, copied into `assets/core/sources/player-models/`.',
      '- Player atlas format: Codex-pet-compatible 8x9 grid, 192x208 cells, PNG RGBA.',
      '- QA evidence: each Maltipoo source folder includes `contact-sheet.png`, `validation.json`, and `pet_request.json`.',
      '- Combat presentation: the Maltipoo atlases do not contain gun-specific rows; shooting remains visible through the BR weapon overlay, muzzle flash, and projectile entities while the model clip maps to the review row.',
      '- Object, weapon, projectile, shield, shadow, and VFX source: generated by `packages/plugin-battle-royale/scripts/generate-content-assets.mjs` from deterministic pixel-art primitives.',
      '- Petwars weapon sprites: imported from `/Users/kregenrek/projects/games/petwars/app/public/assets/graphics/weapons/manifest.json` and copied into `assets/core/atlases/weapons/` as first-class selectable placeables.',
      '- Generated at fixed timestamp `2026-06-08T00:00:00.000Z` for stable manifests.',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(root, 'assets', 'index.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        pack: { id: ids.pack, path: './core', version: '0.1.0' },
        assets: manifest.assets.map((asset) => ({
          id: asset.id,
          path: `./core/${asset.path}`,
          kind: 'image',
          license: asset.license,
        })),
        playerModels: PLAYER_MODELS.map((model) => ({
          id: model.id,
          label: model.label,
          assetFormat: 'codex_pet',
          placeableId: id('placeable', model.placeableNumber),
          sourcePath: `./core/${model.sourcePath}`,
          contactSheetPath: `./core/${model.contactSheetPath}`,
          validationPath: `./core/${model.validationPath}`,
        })),
        weapons: petwarsWeapons.map((weapon, index) => ({
          slug: weapon.slug,
          label: weapon.label,
          kind: weapon.kind,
          placeableId: id('placeable', WEAPON_PLACEABLE_BASE + index),
          path: `./core/${weapon.atlasPath}`,
        })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
};

await main();
