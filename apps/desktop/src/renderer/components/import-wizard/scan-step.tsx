import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@tileborne/ui';
import type {
  ImportCenterDiagnostic,
  TiledImportInventoryPreview,
  TiledImportRecommendation,
} from '@tileborne/ipc-contracts';

import type { TiledImportScanView } from './types';
import { DiagnosticsReport } from './diagnostics-report';

const countEntries = (scan: TiledImportScanView | undefined) =>
  [
    ['Maps', scan?.inventory?.mapCount ?? 0],
    ['Tilesets', scan?.inventory?.tilesetCount ?? 0],
    ['Wang', scan?.inventory?.wangSetCount ?? 0],
    ['Terrain', scan?.inventory?.terrainClassCount ?? 0],
    ['Animations', scan?.inventory?.animationCount ?? 0],
    ['Collisions', scan?.inventory?.collisionObjectCount ?? 0],
    ['Objects', scan?.inventory?.objectLayerCount ?? 0],
    ['Placeables', scan?.inventory?.placeableCandidateCount ?? 0],
  ] as const;

const recommendationProfileLabel = (recommendation: TiledImportRecommendation): string =>
  typeof recommendation.recommendedProfile === 'object'
    ? `plugin:${recommendation.recommendedProfile.id}`
    : recommendation.recommendedProfile;

export function ScanStep({
  scan,
  diagnostics = [],
  inventoryPreview,
  recommendation,
  pending,
}: {
  readonly scan?: TiledImportScanView | undefined;
  readonly diagnostics?: readonly ImportCenterDiagnostic[] | undefined;
  readonly inventoryPreview?: TiledImportInventoryPreview | undefined;
  readonly recommendation?: TiledImportRecommendation | undefined;
  readonly pending: boolean;
}) {
  if (pending) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {recommendation ? (
        <Card>
          <CardHeader>
            <CardTitle>Recommended import</CardTitle>
            <CardDescription>{recommendation.rationale}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2" data-testid="import-center-recommendation">
              <Badge variant="default">{recommendation.primaryAction}</Badge>
              <Badge variant="secondary">
                Profile: {recommendationProfileLabel(recommendation)}
              </Badge>
              <Badge variant="outline">Open: {recommendation.browseTarget}</Badge>
              {recommendation.reviewRequired ? (
                <Badge variant="outline">Review required</Badge>
              ) : null}
            </div>
            {recommendation.sourceRoles.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {recommendation.sourceRoles.map((role, index) => (
                  <div
                    key={`${role.kind}:${role.tilesetName ?? role.layerName ?? index}`}
                    className="rounded-md border bg-muted/30 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span>{role.kind}</span>
                      <Badge variant="secondary">{Math.round(role.confidence * 100)}%</Badge>
                      <Badge variant="outline">Count: {role.count}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{role.rationale}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Analysis inventory</CardTitle>
          <CardDescription>Detected source content, import shape, and confidence.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2" data-testid="import-center-analysis-inventory">
            {scan?.sourceKind ? <Badge variant="default">{scan.sourceKind}</Badge> : null}
            {countEntries(scan).map(([label, count]) => (
              <Badge key={label} variant="secondary">
                {label}: {count}
              </Badge>
            ))}
            <Badge variant="outline">
              Images: {inventoryPreview?.imageAssetCount ?? scan?.imageAssets.length ?? 0}
            </Badge>
            <Badge variant="outline">
              Confidence: {Math.round((scan?.confidence ?? 0) * 100)}%
            </Badge>
          </div>
        </CardContent>
      </Card>
      <DiagnosticsReport
        diagnostics={diagnostics}
        unsupportedFeatures={scan?.unsupportedFeatures}
        ambiguousAtlasObjects={scan?.ambiguousAtlasObjects}
      />
    </div>
  );
}
