import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@tileborne/ui';

import { LibraryPreviewThumb } from '@/components/asset-library/library-preview-thumb';
import type { LibraryPreviewRef } from '@/lib/asset-library-bridge';

import type { TiledImportLicenseDraft, TiledImportPlanView, TiledImportScanView } from './types';

type PreviewItem = {
  readonly id: string;
  readonly kind: 'autotile' | 'terrain' | 'tile' | 'placeable';
  readonly label: string;
  readonly preview?: LibraryPreviewRef | undefined;
};

type PlaceablePlanItem = NonNullable<
  NonNullable<TiledImportPlanView['mappings']>['placeables']
>[number];

const previewFromPlaceable = (placeable: PlaceablePlanItem): LibraryPreviewRef | undefined =>
  placeable.image === undefined
    ? undefined
    : {
        assetPath: placeable.image,
        x: 0,
        y: 0,
        width: placeable.width,
        height: placeable.height,
      };

const starterPreviewItems = (
  scan: TiledImportScanView | undefined,
  plan: TiledImportPlanView | undefined,
): readonly PreviewItem[] => {
  const tilesets = scan?.tilesets ?? [];
  const placeables = plan?.mappings?.placeables ?? [];
  return [
    ...tilesets
      .filter((tileset) => (tileset.wangSetCount ?? 0) > 0)
      .map((tileset) => ({
        id: `autotile-${tileset.name}`,
        kind: 'autotile' as const,
        label: tileset.name,
      })),
    ...tilesets
      .filter((tileset) => (tileset.terrainClassCount ?? 0) > 0)
      .map((tileset) => ({
        id: `terrain-${tileset.name}`,
        kind: 'terrain' as const,
        label: tileset.name,
      })),
    ...tilesets
      .filter((tileset) => tileset.kind === 'grid')
      .map((tileset) => ({
        id: `tile-${tileset.name}`,
        kind: 'tile' as const,
        label: tileset.name,
      })),
    ...placeables.map((placeable) => ({
      id: `placeable-${placeable.tilesetName}-${placeable.localTileId}`,
      kind: 'placeable' as const,
      label: placeable.category ?? placeable.tilesetName,
      preview: previewFromPlaceable(placeable),
    })),
  ].slice(0, 13);
};

export function ConfirmStep({
  scan,
  plan,
  license,
  sourceKind = 'tiled-source',
}: {
  readonly scan?: TiledImportScanView | undefined;
  readonly plan?: TiledImportPlanView | undefined;
  readonly license: TiledImportLicenseDraft;
  readonly sourceKind?: 'tileborne-pack' | 'tiled-source' | undefined;
}) {
  const previewItems = starterPreviewItems(scan, plan);
  const visiblePreviewItems = previewItems.slice(0, 12);
  const overflowCount = Math.max(0, previewItems.length - visiblePreviewItems.length);
  const pendingPackId = plan?.sourcePath ?? scan?.sourcePath ?? 'pending-import';

  return (
    <section className="grid gap-3">
      <Card>
        <CardHeader>
          <CardTitle>Import summary</CardTitle>
          <CardDescription>
            Review the{' '}
            {sourceKind === 'tileborne-pack'
              ? 'Tileborne pack'
              : 'materialized asset pack and starter palette inputs'}
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{scan?.inventory?.tilesetCount ?? 0} tilesets</Badge>
            <Badge variant="secondary">{scan?.inventory?.wangSetCount ?? 0} autotile groups</Badge>
            <Badge variant="secondary">
              {scan?.inventory?.terrainClassCount ?? 0} terrain classes
            </Badge>
            <Badge variant="secondary">{plan?.mappings?.placeables?.length ?? 0} placeables</Badge>
            <Badge variant={license.redistributable ? 'secondary' : 'outline'}>
              Redistributable: {license.redistributable ? 'yes' : 'no'}
            </Badge>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Working Palette preview</CardTitle>
          <CardDescription>Starter palette items seeded after import.</CardDescription>
        </CardHeader>
        <CardContent>
          {visiblePreviewItems.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No starter palette items</CardTitle>
                <CardDescription>
                  The import can continue without seeding a Working Palette.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visiblePreviewItems.map((item) => (
                <li key={item.id}>
                  <Card>
                    <CardHeader>
                      <CardTitle>{item.label}</CardTitle>
                      <CardDescription>{item.kind}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {item.preview === undefined ? (
                        <Skeleton className="size-10" />
                      ) : (
                        <LibraryPreviewThumb
                          packId={pendingPackId}
                          preview={item.preview}
                          sizePx={40}
                          testId="confirm-working-palette-preview-thumb"
                        />
                      )}
                    </CardContent>
                  </Card>
                </li>
              ))}
              {overflowCount > 0 ? (
                <li>
                  <Card>
                    <CardHeader>
                      <CardTitle>More items</CardTitle>
                      <CardDescription>
                        <Badge variant="secondary">+{overflowCount}</Badge>
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </li>
              ) : null}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
