import type { ImportCenterDiagnostic, TiledImportScan } from '@tileborne/ipc-contracts';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@tileborne/ui';

type UnsupportedFeature = TiledImportScan['unsupportedFeatures'][number];
type AmbiguousAtlasObject = TiledImportScan['ambiguousAtlasObjects'][number];

const severityVariant = (
  severity: ImportCenterDiagnostic['severity'],
): 'default' | 'secondary' | 'destructive' =>
  severity === 'error' ? 'destructive' : severity === 'warning' ? 'secondary' : 'default';

export function DiagnosticsReport({
  diagnostics,
  unsupportedFeatures = [],
  ambiguousAtlasObjects = [],
}: {
  readonly diagnostics: readonly ImportCenterDiagnostic[];
  readonly unsupportedFeatures?: readonly UnsupportedFeature[] | undefined;
  readonly ambiguousAtlasObjects?: readonly AmbiguousAtlasObject[] | undefined;
}) {
  const hasDiagnostics =
    diagnostics.length > 0 || unsupportedFeatures.length > 0 || ambiguousAtlasObjects.length > 0;

  return (
    <Card data-testid="import-center-diagnostics-report">
      <CardHeader>
        <CardTitle>Diagnostics and fix report</CardTitle>
        <CardDescription>
          Review blocking issues, degraded features, and safe follow-up actions before apply.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {hasDiagnostics ? null : (
          <Alert>
            <AlertTitle>No blocking diagnostics</AlertTitle>
            <AlertDescription>
              The source can be imported with the current profile.
            </AlertDescription>
          </Alert>
        )}
        {diagnostics.map((diagnostic) => (
          <Alert key={`${diagnostic._tag}-${diagnostic.path}-${diagnostic.message}`}>
            <AlertTitle className="flex flex-wrap items-center gap-2">
              <Badge variant={severityVariant(diagnostic.severity)}>{diagnostic.severity}</Badge>
              <span>{diagnostic._tag}</span>
              {diagnostic.feature ? <Badge variant="outline">{diagnostic.feature}</Badge> : null}
            </AlertTitle>
            <AlertDescription>
              <span className="grid gap-1">
                <span>{diagnostic.message}</span>
                <span className="text-xs text-muted-foreground">{diagnostic.path}</span>
                {diagnostic.action ? <span>{diagnostic.action}</span> : null}
              </span>
            </AlertDescription>
          </Alert>
        ))}
        {unsupportedFeatures.map((feature) => (
          <Alert key={`${feature.feature}-${feature.path}`}>
            <AlertTitle className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">warning</Badge>
              <span>{feature.feature}</span>
            </AlertTitle>
            <AlertDescription>
              <span className="grid gap-1">
                <span>{feature.message}</span>
                <span className="text-xs text-muted-foreground">{feature.path}</span>
                <span>{feature.action}</span>
              </span>
            </AlertDescription>
          </Alert>
        ))}
        {ambiguousAtlasObjects.map((entry) => (
          <Alert key={`${entry.tilesetName}-${entry.localTileId}-${entry.path}`}>
            <AlertTitle className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">review</Badge>
              <span>
                {entry.tilesetName} tile {entry.localTileId}
              </span>
            </AlertTitle>
            <AlertDescription>
              <span className="grid gap-1">
                <span>{entry.message}</span>
                <span className="text-xs text-muted-foreground">{entry.path}</span>
              </span>
            </AlertDescription>
          </Alert>
        ))}
      </CardContent>
    </Card>
  );
}
