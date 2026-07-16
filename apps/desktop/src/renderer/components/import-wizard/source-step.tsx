import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
} from '@tileborne/ui';
import { FolderOpenIcon } from 'lucide-react';

import type { ImportSourceDetection } from './types';

interface SourceStepProps {
  readonly sourcePath: string;
  readonly pending: boolean;
  readonly detection?: ImportSourceDetection | undefined;
  readonly onSourcePathChange: (value: string) => void;
  readonly onPick: () => void;
}

const detectionTitle = (detection: ImportSourceDetection): string => {
  if (detection.kind === 'ambiguous') return 'Ambiguous import source';
  if (detection.kind === 'zip') return 'Zip import is blocked';
  if (detection.kind === 'unsupported' && detection.tiledTilesetCount > 0) {
    return 'Tiled tileset requires a map';
  }
  if (detection.kind === 'unsupported') return 'Import source not recognized';
  if (detection.kind === 'tileborne-pack') return 'Tileborne pack detected';
  return 'Tiled source detected';
};

export function SourceStep({
  sourcePath,
  pending,
  detection,
  onSourcePathChange,
  onPick,
}: SourceStepProps) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="import-source">Import source</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="import-source"
            value={sourcePath}
            onChange={(event) => onSourcePathChange(event.currentTarget.value)}
            placeholder="/path/to/pack-folder, map.tmx, tileset.tsx, or source folder"
            aria-label="Import source path"
            disabled={pending}
          />
          <Button type="button" variant="outline" disabled={pending} onClick={onPick}>
            <FolderOpenIcon data-icon="inline-start" />
            Browse
          </Button>
        </div>
        <FieldDescription>
          Choose a Tileborne pack folder, raw Tiled source folder, .tmx/.tmj map, or standalone
          .tsx/.tsj tileset.
        </FieldDescription>
      </Field>
      {detection !== undefined ? (
        <Alert data-testid="import-source-detection">
          <AlertTitle>{detectionTitle(detection)}</AlertTitle>
          <AlertDescription>
            <span className="flex flex-col gap-2">
              <span>{detection.message}</span>
              <span className="flex flex-wrap gap-2">
                {detection.detectedTypes.length === 0 ? (
                  <Badge variant="outline">No supported content</Badge>
                ) : (
                  detection.detectedTypes.map((type) => (
                    <Badge key={type} variant="secondary">
                      {type}
                    </Badge>
                  ))
                )}
                <Badge variant="outline">{detection.tiledMapCount} maps</Badge>
                <Badge variant="outline">{detection.tiledTilesetCount} tilesets</Badge>
              </span>
              {detection.kind === 'ambiguous' ? (
                <span>Press Continue again to use the detected Tileborne pack flow.</span>
              ) : null}
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
    </FieldGroup>
  );
}
