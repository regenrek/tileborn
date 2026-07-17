import { AssetId, canonicalJson, sha256Hex } from '@tileborne/core';

const uuidFromSha256 = (hex: string): string => {
  const chars = hex.slice(0, 32).split('');
  chars[12] = '4';
  chars[16] = ((Number.parseInt(chars[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const id = chars.join('');
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
};

export const allocateAssetIds = (
  seedHash: string,
  candidates: readonly string[],
): Map<string, AssetId> => {
  const allocations = new Map<string, AssetId>();

  for (const candidatePath of [...candidates].sort((left, right) => left.localeCompare(right))) {
    const digest = sha256Hex(
      canonicalJson({
        candidatePath,
        seedHash,
      }),
    );
    allocations.set(candidatePath, `asset:${uuidFromSha256(digest)}` as AssetId);
  }

  return allocations;
};
