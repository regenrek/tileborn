import { Schema } from 'effect';

import {
  AssetLibraryReference,
  ProjectId,
  WorkingPalette,
  WorkingPaletteId,
  WorkingPaletteItemId,
} from '@tileborne/core';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { EmptyResponse, IpcContractErrors } from './common.js';

export const WorkingPaletteItemDraft = Schema.Struct({
  ref: AssetLibraryReference,
  label: Schema.optional(Schema.String),
});

export const WorkingPalettesProjectRequest = Schema.Struct({
  projectId: Schema.optional(ProjectId),
});

export const WorkingPalettesListResponse = Schema.Struct({
  palettes: Schema.Array(WorkingPalette),
  activePaletteId: Schema.optional(WorkingPaletteId),
});

export const WorkingPalettesGetActiveResponse = Schema.Struct({
  palette: Schema.optional(WorkingPalette),
});

export const WorkingPalettesCreateRequest = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  name: Schema.String,
  items: Schema.optional(Schema.Array(WorkingPaletteItemDraft)),
});

export const WorkingPalettesPaletteRequest = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  paletteId: WorkingPaletteId,
});

export const WorkingPalettesPaletteResponse = Schema.Struct({
  palette: WorkingPalette,
});

export const WorkingPalettesUpdateRequest = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  paletteId: WorkingPaletteId,
  name: Schema.optional(Schema.String),
  items: Schema.optional(Schema.Array(WorkingPaletteItemDraft)),
});

export const WorkingPalettesAddItemsRequest = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  paletteId: WorkingPaletteId,
  items: Schema.Array(WorkingPaletteItemDraft),
  atIndex: Schema.optional(Schema.Number),
});

export const WorkingPalettesRemoveItemRequest = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  paletteId: WorkingPaletteId,
  itemId: WorkingPaletteItemId,
});

export const WorkingPalettesReorderItemsRequest = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  paletteId: WorkingPaletteId,
  itemIds: Schema.Array(WorkingPaletteItemId),
});

export const WorkingPalettesListContract = defineContract({
  channel: 'tileborne:working-palettes:list',
  request: WorkingPalettesProjectRequest,
  response: WorkingPalettesListResponse,
  errors: IpcContractErrors,
});

export const WorkingPalettesGetActiveContract = defineContract({
  channel: 'tileborne:working-palettes:getActive',
  request: WorkingPalettesProjectRequest,
  response: WorkingPalettesGetActiveResponse,
  errors: IpcContractErrors,
});

export const WorkingPalettesCreateContract = defineContract({
  channel: 'tileborne:working-palettes:create',
  request: WorkingPalettesCreateRequest,
  response: WorkingPalettesPaletteResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000 },
});

export const WorkingPalettesUpdateContract = defineContract({
  channel: 'tileborne:working-palettes:update',
  request: WorkingPalettesUpdateRequest,
  response: WorkingPalettesPaletteResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000 },
});

export const WorkingPalettesDeleteContract = defineContract({
  channel: 'tileborne:working-palettes:delete',
  request: WorkingPalettesPaletteRequest,
  response: EmptyResponse,
  errors: IpcContractErrors,
  meta: { timeoutMs: 30_000 },
});

export const WorkingPalettesSetActiveContract = defineContract({
  channel: 'tileborne:working-palettes:setActive',
  request: WorkingPalettesPaletteRequest,
  response: WorkingPalettesPaletteResponse,
  errors: IpcContractErrors,
});

export const WorkingPalettesAddItemsContract = defineContract({
  channel: 'tileborne:working-palettes:addItems',
  request: WorkingPalettesAddItemsRequest,
  response: WorkingPalettesPaletteResponse,
  errors: IpcContractErrors,
});

export const WorkingPalettesRemoveItemContract = defineContract({
  channel: 'tileborne:working-palettes:removeItem',
  request: WorkingPalettesRemoveItemRequest,
  response: WorkingPalettesPaletteResponse,
  errors: IpcContractErrors,
});

export const WorkingPalettesReorderItemsContract = defineContract({
  channel: 'tileborne:working-palettes:reorderItems',
  request: WorkingPalettesReorderItemsRequest,
  response: WorkingPalettesPaletteResponse,
  errors: IpcContractErrors,
});

export const WorkingPalettesContracts = [
  WorkingPalettesListContract,
  WorkingPalettesGetActiveContract,
  WorkingPalettesCreateContract,
  WorkingPalettesUpdateContract,
  WorkingPalettesDeleteContract,
  WorkingPalettesSetActiveContract,
  WorkingPalettesAddItemsContract,
  WorkingPalettesRemoveItemContract,
  WorkingPalettesReorderItemsContract,
] as const;

export const WorkingPalettesIpcRegistry = createRegistry(WorkingPalettesContracts);
