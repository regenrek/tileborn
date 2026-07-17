import {
  makeLayerId,
  makeMapId,
  makeObjectId,
  sha256Hex,
  type MapId,
  type ObjectId,
  type Uuid,
} from '@tileborne/core';

const seedDigest = (seed: string | number, salt: string): string =>
  sha256Hex(`${String(seed)}:${salt}`);

export const uuidFromSeed = (seed: string | number, salt: string): Uuid => {
  const digest = seedDigest(seed, salt);
  const variant = ((Number.parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, '0');
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `${variant}${digest.slice(18, 20)}`,
    digest.slice(20, 32),
  ].join('-') as Uuid;
};

export const mapIdFromSeed = (seed: string | number): MapId => makeMapId(uuidFromSeed(seed, 'map'));

export const objectIdFromSeed = (seed: string | number, salt: string): ObjectId =>
  makeObjectId(uuidFromSeed(seed, salt));

export const layerIdFromSeed = (seed: string | number, salt: string) =>
  makeLayerId(uuidFromSeed(seed, salt));

export const TEST_MAP_ID = makeMapId('550e8400-e29b-41d4-a716-446655440000');
export const TEST_LAYER_ID = makeLayerId('550e8400-e29b-41d4-a716-446655440001');
export const TEST_OBJECT_IDS = [
  makeObjectId('550e8400-e29b-41d4-a716-446655440010'),
  makeObjectId('550e8400-e29b-41d4-a716-446655440011'),
  makeObjectId('550e8400-e29b-41d4-a716-446655440012'),
  makeObjectId('550e8400-e29b-41d4-a716-446655440013'),
  makeObjectId('550e8400-e29b-41d4-a716-446655440014'),
  makeObjectId('550e8400-e29b-41d4-a716-446655440015'),
  makeObjectId('550e8400-e29b-41d4-a716-446655440016'),
  makeObjectId('550e8400-e29b-41d4-a716-446655440017'),
] as const;
