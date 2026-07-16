import type { ImportCenterApplyReport } from '@tileborne/ipc-contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@tileborne/ui';

import { DiagnosticsReport } from './diagnostics-report';

export function ResultStep({
  mapId,
  packId,
  jobId,
  report,
  sourceKind = 'tiled-source',
  resultKind,
  onOpenMap,
  onClose,
}: {
  readonly mapId?: string | undefined;
  readonly packId?: string | undefined;
  readonly jobId?: string | undefined;
  readonly report?: ImportCenterApplyReport | undefined;
  readonly sourceKind?: 'tileborne-pack' | 'tiled-source' | undefined;
  readonly resultKind?: 'map' | 'asset-pack' | 'tileborne-pack' | undefined;
  readonly onOpenMap: () => void;
  readonly onClose: () => void;
}) {
  const isQueuedPackImport = sourceKind === 'tileborne-pack' || resultKind === 'tileborne-pack';
  const isTiledAssetPackImport = resultKind === 'asset-pack';
  return (
    <div className="grid gap-3">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {isQueuedPackImport
              ? 'Asset pack import started'
              : isTiledAssetPackImport
                ? 'Tiled asset pack imported'
                : 'Tiled map imported'}
          </EmptyTitle>
          <EmptyDescription>
            {isQueuedPackImport
              ? `Import job ${jobId ?? 'created'} is queued for the selected Tileborne pack.`
              : isTiledAssetPackImport
                ? `Pack ${packId ?? 'created'} is ready. The starter working palette is active.`
                : `Pack ${packId ?? 'created'} and map ${mapId ?? 'created'} are ready. The starter working palette is active.`}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {isQueuedPackImport || isTiledAssetPackImport ? null : (
            <Button type="button" onClick={onOpenMap}>
              Continue editing map
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </EmptyContent>
      </Empty>
      {report ? (
        <>
          <Card data-testid="import-center-apply-report">
            <CardHeader>
              <CardTitle>ImportRecord report</CardTitle>
              <CardDescription>{report.importRecordId}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{report.sourceIdentity.kind}</Badge>
                <Badge variant="outline">{report.outputs.kind}</Badge>
                {report.outputs.packId ? (
                  <Badge variant="outline">Pack {report.outputs.packId}</Badge>
                ) : null}
                {report.outputs.mapId ? (
                  <Badge variant="outline">Map {report.outputs.mapId}</Badge>
                ) : null}
                {report.outputs.layerCount !== undefined ? (
                  <Badge variant="outline">{report.outputs.layerCount} layers</Badge>
                ) : null}
                {report.outputs.objectCount !== undefined ? (
                  <Badge variant="outline">{report.outputs.objectCount} objects</Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">{report.sourceIdentity.path}</p>
            </CardContent>
          </Card>
          <DiagnosticsReport diagnostics={report.diagnostics} />
        </>
      ) : null}
    </div>
  );
}
