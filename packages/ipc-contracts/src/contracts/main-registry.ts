import { createRegistry, type IpcRegistry } from '../registry.js';
import { AssetLibraryContracts } from './asset-library.js';
import { AssetsContracts } from './assets.js';
import { BuildsContracts } from './builds.js';
import { CatalogContracts } from './catalog.js';
import { TiledSourceRulesContracts } from './tiled-source-rules.js';
import { ExportsContracts } from './exports.js';
import { JobsContracts } from './jobs.js';
import { LogsContracts } from './logs.js';
import { MapsContracts } from './maps.js';
import { PlaytestContracts } from './playtest.js';
import { PluginsContracts } from './plugins.js';
import { ProjectsContracts } from './projects.js';
import { RuntimeContracts } from './runtime.js';
import { RuntimeDeployContracts } from './runtime-deploy.js';
import { SupportContracts } from './support.js';
import { SystemContracts } from './system.js';
import { TiledImportContracts } from './tiled-import.js';
import { WorkingPalettesContracts } from './working-palettes.js';

export const MainIpcContracts = [
  ...ProjectsContracts,
  ...MapsContracts,
  ...AssetsContracts,
  ...AssetLibraryContracts,
  ...WorkingPalettesContracts,
  ...CatalogContracts,
  ...PluginsContracts,
  ...JobsContracts,
  ...LogsContracts,
  ...TiledImportContracts,
  ...BuildsContracts,
  ...ExportsContracts,
  ...TiledSourceRulesContracts,
  ...PlaytestContracts,
  ...RuntimeContracts,
  ...RuntimeDeployContracts,
  ...SupportContracts,
  ...SystemContracts,
] as const;

export type MainIpcRegistry = IpcRegistry<typeof MainIpcContracts>;

export const MainIpcRegistry = createRegistry(MainIpcContracts);
