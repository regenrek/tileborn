import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@tileborne/ui';
import type { ReactNode } from 'react';

import type { TiledImportPlanView, TiledImportScanView } from './types';
import { DiagnosticsReport } from './diagnostics-report';

type TabGroup = {
  readonly value: string;
  readonly label: string;
  readonly count: number;
  readonly content: ReactNode;
};

type ReviewTileset =
  | NonNullable<NonNullable<TiledImportPlanView['mappings']>['tilesets']>[number]
  | NonNullable<TiledImportScanView['tilesets']>[number];

const confidenceBadge = (confidence: number | undefined) =>
  confidence === undefined ? null : (
    <Badge variant="outline">Confidence {Math.round(confidence * 100)}%</Badge>
  );

const emptyDescription = (label: string) => (
  <FieldDescription>No {label.toLowerCase()} entries in this import plan.</FieldDescription>
);

const tilesetCategories = (tileset: ReviewTileset): readonly string[] =>
  (tileset as { readonly categoryIds?: readonly string[]; readonly categories?: readonly string[] })
    .categoryIds ??
  (tileset as { readonly categoryIds?: readonly string[]; readonly categories?: readonly string[] })
    .categories ??
  [];

export function MappingReviewStep({
  scan,
  plan,
  acceptedSuggestionIds,
  onAcceptedSuggestionIdsChange,
}: {
  readonly scan?: TiledImportScanView | undefined;
  readonly plan?: TiledImportPlanView | undefined;
  readonly acceptedSuggestionIds: readonly string[];
  readonly onAcceptedSuggestionIdsChange: (ids: readonly string[]) => void;
}) {
  const accepted = new Set(acceptedSuggestionIds);
  const toggleSuggestion = (id: string, checked: boolean) => {
    onAcceptedSuggestionIdsChange(
      checked
        ? [...acceptedSuggestionIds, id]
        : acceptedSuggestionIds.filter((entry) => entry !== id),
    );
  };
  const mappedTilesets = plan?.mappings?.tilesets ?? [];
  const scanTilesets = scan?.tilesets ?? [];
  const tilesets = mappedTilesets.length > 0 ? mappedTilesets : scanTilesets;
  const categories = plan?.mappings?.categories ?? scan?.categories ?? [];
  const placeables = plan?.mappings?.placeables ?? [];
  const wangTilesets = scanTilesets.filter((tileset) => (tileset.wangSetCount ?? 0) > 0);
  const terrainTilesets = scanTilesets.filter((tileset) => (tileset.terrainClassCount ?? 0) > 0);
  const animationTilesets = scanTilesets.filter((tileset) => (tileset.animationCount ?? 0) > 0);
  const collisionTilesets = scanTilesets.filter(
    (tileset) => (tileset.collisionObjectCount ?? 0) > 0,
  );
  const objectLayers = scan?.objectLayers ?? [];

  const groups: readonly TabGroup[] = [
    {
      value: 'tilesets',
      label: 'Tilesets',
      count: tilesets.length,
      content:
        tilesets.length === 0
          ? emptyDescription('Tilesets')
          : tilesets.map((tileset) => (
              <Card key={tileset.name}>
                <CardHeader>
                  <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate">{tileset.name}</span>
                    <Badge variant="secondary">{tileset.kind}</Badge>
                    {'tileCount' in tileset ? (
                      <Badge variant="outline">{tileset.tileCount} tiles</Badge>
                    ) : null}
                    {confidenceBadge(tileset.confidence)}
                  </CardTitle>
                  {tilesetCategories(tileset).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {tilesetCategories(tileset).map((category) => (
                        <Badge key={category} variant="outline">
                          {category}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor={`tileset-name-${tileset.name}`}>Display name</FieldLabel>
                      <Input
                        id={`tileset-name-${tileset.name}`}
                        defaultValue={tileset.name}
                        aria-label={`Rename ${tileset.name}`}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`tileset-categories-${tileset.name}`}>
                        Categories
                      </FieldLabel>
                      <Input
                        id={`tileset-categories-${tileset.name}`}
                        defaultValue={tilesetCategories(tileset).join(', ')}
                        placeholder="e.g. terrain, walls"
                        aria-label={`Categories for ${tileset.name}`}
                      />
                      <FieldDescription>
                        Comma-separated tags used to group this tileset in the asset library.
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                </CardContent>
              </Card>
            )),
    },
    {
      value: 'wang',
      label: 'Wang/Autotiles',
      count: wangTilesets.reduce((count, tileset) => count + (tileset.wangSetCount ?? 0), 0),
      content:
        wangTilesets.length === 0
          ? emptyDescription('Wang/Autotiles')
          : wangTilesets.map((tileset) => (
              <Card key={`wang-${tileset.name}`}>
                <CardHeader>
                  <CardTitle className="truncate">{tileset.name}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{tileset.wangSetCount ?? 0} autotile groups</Badge>
                  {confidenceBadge(tileset.confidence)}
                </CardContent>
              </Card>
            )),
    },
    {
      value: 'terrain',
      label: 'Terrain',
      count: terrainTilesets.reduce(
        (count, tileset) => count + (tileset.terrainClassCount ?? 0),
        0,
      ),
      content:
        terrainTilesets.length === 0
          ? emptyDescription('Terrain')
          : terrainTilesets.map((tileset) => (
              <Card key={`terrain-${tileset.name}`}>
                <CardHeader>
                  <CardTitle className="truncate">{tileset.name}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {tileset.terrainClassCount ?? 0} terrain classes
                  </Badge>
                  {confidenceBadge(tileset.confidence)}
                </CardContent>
              </Card>
            )),
    },
    {
      value: 'placeables',
      label: 'Placeables',
      count: placeables.length,
      content:
        placeables.length === 0
          ? emptyDescription('Placeables')
          : placeables.map((placeable) => (
              <Card key={`${placeable.tilesetName}-${placeable.localTileId}`}>
                <CardHeader>
                  <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate">{placeable.tilesetName}</span>
                    <Badge variant="secondary">tile {placeable.localTileId}</Badge>
                    <Badge variant="outline">
                      {placeable.width}×{placeable.height}
                    </Badge>
                    {placeable.category ? (
                      <Badge variant="outline">{placeable.category}</Badge>
                    ) : null}
                    {confidenceBadge(placeable.confidence)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <FieldGroup>
                    <Field>
                      <FieldLabel
                        htmlFor={`placeable-name-${placeable.tilesetName}-${placeable.localTileId}`}
                      >
                        Display name
                      </FieldLabel>
                      <Input
                        id={`placeable-name-${placeable.tilesetName}-${placeable.localTileId}`}
                        defaultValue={placeable.tilesetName}
                        aria-label={`Rename placeable ${placeable.localTileId}`}
                      />
                    </Field>
                    <Field>
                      <FieldLabel
                        htmlFor={`placeable-category-${placeable.tilesetName}-${placeable.localTileId}`}
                      >
                        Category
                      </FieldLabel>
                      <Input
                        id={`placeable-category-${placeable.tilesetName}-${placeable.localTileId}`}
                        defaultValue={placeable.category ?? ''}
                        placeholder="e.g. props, decor"
                        aria-label={`Category for placeable ${placeable.localTileId}`}
                      />
                    </Field>
                  </FieldGroup>
                </CardContent>
              </Card>
            )),
    },
    {
      value: 'object-classes',
      label: 'Object Classes',
      count: objectLayers.length,
      content:
        objectLayers.length === 0
          ? emptyDescription('Object Classes')
          : objectLayers.map((layer) => (
              <Card key={`object-${layer.name}`}>
                <CardHeader>
                  <CardTitle className="truncate">{layer.name}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{layer.objectCount} objects</Badge>
                  <Badge variant="outline">{layer.gidObjectCount} tile objects</Badge>
                  {confidenceBadge(layer.confidence)}
                  {(layer.categories ?? []).map((category) => (
                    <Badge key={category} variant="outline">
                      {category}
                    </Badge>
                  ))}
                </CardContent>
              </Card>
            )),
    },
    {
      value: 'categories',
      label: 'Categories',
      count: categories.length,
      content:
        categories.length === 0 ? (
          emptyDescription('Categories')
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <Badge key={category.id} variant="secondary">
                {category.label} ({category.count})
              </Badge>
            ))}
          </div>
        ),
    },
    {
      value: 'animations',
      label: 'Animations',
      count: animationTilesets.reduce((count, tileset) => count + (tileset.animationCount ?? 0), 0),
      content:
        animationTilesets.length === 0
          ? emptyDescription('Animations')
          : animationTilesets.map((tileset) => (
              <Card key={`animation-${tileset.name}`}>
                <CardHeader>
                  <CardTitle className="truncate">{tileset.name}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{tileset.animationCount ?? 0} animations</Badge>
                  {confidenceBadge(tileset.confidence)}
                </CardContent>
              </Card>
            )),
    },
    {
      value: 'collisions',
      label: 'Collisions',
      count: collisionTilesets.reduce(
        (count, tileset) => count + (tileset.collisionObjectCount ?? 0),
        0,
      ),
      content:
        collisionTilesets.length === 0
          ? emptyDescription('Collisions')
          : collisionTilesets.map((tileset) => (
              <Card key={`collision-${tileset.name}`}>
                <CardHeader>
                  <CardTitle className="truncate">{tileset.name}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {tileset.collisionObjectCount ?? 0} collision objects
                  </Badge>
                  {confidenceBadge(tileset.confidence)}
                </CardContent>
              </Card>
            )),
    },
    {
      value: 'suggestions',
      label: 'Suggestions',
      count: plan?.suggestions?.length ?? 0,
      content:
        (plan?.suggestions ?? []).length === 0
          ? emptyDescription('Suggestions')
          : (plan?.suggestions ?? []).map((suggestion) => (
              <label
                key={suggestion.id}
                className="flex items-start gap-2 rounded-md border p-2 text-sm"
              >
                <Checkbox
                  checked={accepted.has(suggestion.id)}
                  onCheckedChange={(checked) => toggleSuggestion(suggestion.id, checked)}
                  aria-label={`Accept ${suggestion.action}`}
                />
                <span className="grid gap-1">
                  <span className="font-medium">{suggestion.action}</span>
                  <span className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{suggestion.reason}</span>
                    <Badge variant="outline">
                      Confidence {Math.round(suggestion.confidence * 100)}%
                    </Badge>
                  </span>
                </span>
              </label>
            )),
    },
  ];
  const visibleGroups = groups.filter((group) => group.count > 0 || group.value === 'suggestions');
  const defaultValue = visibleGroups[0]?.value ?? 'tilesets';

  return (
    <div className="grid min-w-0 gap-3">
      <DiagnosticsReport diagnostics={plan?.diagnostics ?? []} />
      <Tabs defaultValue={defaultValue} className="grid min-w-0 gap-3">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          {visibleGroups.map((group) => (
            <TabsTrigger key={group.value} value={group.value} className="flex-none">
              {group.label}
              <Badge variant="secondary">{group.count}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        {visibleGroups.map((group) => (
          <TabsContent key={group.value} value={group.value} className="min-w-0">
            <div className="grid min-w-0 gap-2">{group.content}</div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
