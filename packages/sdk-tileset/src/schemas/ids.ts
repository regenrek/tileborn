import { Schema } from 'effect';

import { ClipId, PackId, PlaceableId, TileId } from '@tileborne/core';

export { ClipId, PackId, PlaceableId, TileId };
export type {
  ClipId as ClipIdType,
  PackId as PackIdType,
  PlaceableId as PlaceableIdType,
  TileId as TileIdType,
};

const definePrefixedId = <Tag extends string>(prefix: string, brand: Tag) => {
  const pattern = new RegExp(
    `^${prefix}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
    'i',
  );
  return Schema.String.check(Schema.isPattern(pattern)).pipe(Schema.brand(brand));
};

/** Branded tileset identifier (`tileset:<uuid>`). */
export const TilesetId = definePrefixedId('tileset', 'TilesetId');
export type TilesetId = typeof TilesetId.Type;

/** Branded autotile rule identifier (`autotile-rule:<uuid>`). */
export const AutotileRuleId = definePrefixedId('autotile-rule', 'AutotileRuleId');
export type AutotileRuleId = typeof AutotileRuleId.Type;

/** Branded variant filter identifier (`variant-filter:<uuid>`). */
export const VariantFilterId = definePrefixedId('variant-filter', 'VariantFilterId');
export type VariantFilterId = typeof VariantFilterId.Type;

/** Branded animation identifier (`animation:<uuid>`). */
export const AnimationId = definePrefixedId('animation', 'AnimationId');
export type AnimationId = typeof AnimationId.Type;
