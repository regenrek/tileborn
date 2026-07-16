# `@tileborne/test-fixtures`

Private workspace package of sample fixtures for tests, smoke suites, and documentation examples.

## Layout

```text
fixtures/
  maps/           # Minimal map JSON stubs
  asset-packs/    # tileborne-asset-pack.json + tiles/
  plugins/        # tileborne-plugin.json + dist/
  projects/       # tileborne-project.json stubs
```

Each fixture directory includes a `PROVENANCE.md` with source and license attribution.

## Usage

```ts
import { getFixturePath, listFixtures } from '@tileborne/test-fixtures';

const pluginRoot = getFixturePath('plugins', 'smoke-fixture');
const packRoot = getFixturePath('asset-packs', 'smoke-pack');
const categories = listFixtures('plugins');
```

The bundled sample asset pack is generated from the SDK Tiled source importer.
