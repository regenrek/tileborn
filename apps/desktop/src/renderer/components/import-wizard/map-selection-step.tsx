import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@tileborne/ui';

import type { TiledImportPlanView } from './types';

export function MapSelectionStep({ plan }: { readonly plan?: TiledImportPlanView | undefined }) {
  const maps = plan?.mappings?.maps ?? [];
  return (
    <Card>
      <CardHeader>
          <CardTitle>Import plan review</CardTitle>
          <CardDescription>The first scanned map is imported first. Additional maps remain registered in the plan.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {maps.map((map, index) => (
            <Badge key={map.path} variant={index === 0 ? 'secondary' : 'outline'}>
              {index === 0 ? 'Primary: ' : ''}
              {map.path} ({map.width}x{map.height})
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
