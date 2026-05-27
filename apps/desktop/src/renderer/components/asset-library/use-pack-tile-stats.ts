import { useMemo } from 'react';

import { useTilesetPack } from '@/hooks/queries';

export function usePackTileStats(packId: string) {
  const packQuery = useTilesetPack(packId);

  return useMemo(() => {
    const pack = packQuery.data;
    if (pack === undefined) {
      return {
        tileCount: 0,
        tileSize: null as string | null,
        loading: packQuery.isLoading,
      };
    }
    const firstTileset = pack.tilesets[0];
    return {
      tileCount: pack.tilesets.reduce(
        (sum, tileset) => sum + tileset.tiles.length,
        0,
      ),
      tileSize:
        firstTileset === undefined
          ? null
          : `${firstTileset.cellSize.width}x${firstTileset.cellSize.height}`,
      loading: packQuery.isLoading,
    };
  }, [packQuery.data, packQuery.isLoading]);
}
