import { randomUUID } from 'node:crypto';

import {
  hashJsonStable,
  makeLayerId,
  makeTileborneMap,
  TileborneMap,
  TileChunk,
  TileLayer,
  Uuid,
} from '@tileborne/core';
import { MapService, MapValidationError } from '@tileborne/services-app';
import { Effect } from 'effect';

import { readMapFile, mapToPersistedJson } from '../../lib/map-io.js';
import { resolveProjectId, readMapIdArg, readProjectSlugArg } from '../../lib/project-context.js';
import { runCliCommand } from '../../lib/run-command.js';
import { CliValidationError } from '../../render/errors.js';
import { globalArgs, readStringArg, type CliRunContext } from '../shared.js';

const readTiledProfileArg = (args: Record<string, unknown>): 'standard' | 'standard-plus-hints' => {
  const profile = readStringArg(args, 'profile') ?? 'standard';
  if (profile === 'standard' || profile === 'standard-plus-hints') {
    return profile;
  }
  throw new CliValidationError({ message: '--profile must be standard or standard-plus-hints' });
};

const validateChunkIntegrity = (map: TileborneMap) => {
  for (const layer of map.layers) {
    if (layer._tag !== 'tile' && layer._tag !== 'collision') {
      continue;
    }
    for (const chunk of layer.chunks) {
      const expected = chunk.width * chunk.height;
      if (chunk.tiles.length !== expected) {
        throw new MapValidationError({
          path: '<map>',
          message: `chunk ${chunk.x},${chunk.y} on ${layer.name} expected ${expected} tiles, got ${chunk.tiles.length}`,
        });
      }
    }
  }
};

const makeTemplateLayers = (template: string, width: number, height: number) => {
  const chunk = new TileChunk({
    x: 0,
    y: 0,
    width,
    height,
    tiles: Array.from({ length: width * height }, (_, index) => {
      if (template === 'grid') {
        return (index + Math.floor(index / width)) % 4 === 0 ? 1 : 0;
      }
      if (template === 'biome') {
        return index % 3;
      }
      return 0;
    }),
  });
  return [
    new TileLayer({
      id: makeLayerId(randomUUID() as Uuid),
      name: template,
      visible: true,
      opacity: 1,
      chunks: [chunk],
    }),
  ];
};

const readTemplateArg = (args: Record<string, unknown>): string =>
  readStringArg(args, 'preset') ?? readStringArg(args, 'template') ?? 'empty';

export const mapCommand = {
  meta: { name: 'map', description: 'Create, validate, export, and import maps' },
  subCommands: {
    export: {
      meta: { name: 'export', description: 'Export a map to canonical JSON or Tiled TMJ' },
      args: {
        ...globalArgs,
        mapId: { type: 'positional' as const, description: 'Map id', required: true },
        format: { type: 'string' as const, description: 'json or tiled', default: 'json' },
        out: { type: 'string' as const, description: 'Output path', required: true },
        project: { type: 'string' as const, description: 'Project slug', required: false },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const projectId = yield* resolveProjectId(readProjectSlugArg(context.args));
            const maps = yield* MapService;
            const mapId = readMapIdArg(context.args, 'mapId');
            const format = readStringArg(context.args, 'format') ?? 'json';
            const out = readStringArg(context.args, 'out');
            if (!out) {
              yield* Effect.fail(new CliValidationError({ message: '--out is required' }));
            }
            if (format !== 'json' && format !== 'tiled') {
              yield* Effect.fail(
                new CliValidationError({ message: 'format must be json or tiled' }),
              );
            }
            return yield* maps.exportToFile(
              projectId,
              mapId,
              format as 'json' | 'tiled',
              out as string,
            );
          }),
        );
      },
    },
    validate: {
      meta: { name: 'validate', description: 'Validate map schema and chunk integrity' },
      args: {
        ...globalArgs,
        mapId: { type: 'positional' as const, description: 'Map id', required: false },
        file: { type: 'string' as const, description: 'Map JSON file path', required: false },
        project: { type: 'string' as const, description: 'Project slug', required: false },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const file = readStringArg(context.args, 'file');
            if (file) {
              const map = yield* Effect.promise(() => readMapFile(file));
              validateChunkIntegrity(map);
              return { ok: true, mapId: map.id, hash: hashJsonStable(mapToPersistedJson(map)) };
            }
            const projectId = yield* resolveProjectId(readProjectSlugArg(context.args));
            const maps = yield* MapService;
            const mapId = readMapIdArg(context.args, 'mapId');
            const map = yield* maps.load(projectId, mapId);
            validateChunkIntegrity(map);
            return { ok: true, mapId: map.id, hash: hashJsonStable(mapToPersistedJson(map)) };
          }),
        );
      },
    },
    inspect: {
      meta: { name: 'inspect', description: 'Summarize map layers and references' },
      args: {
        ...globalArgs,
        mapId: { type: 'positional' as const, description: 'Map id', required: true },
        project: { type: 'string' as const, description: 'Project slug', required: false },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const projectId = yield* resolveProjectId(readProjectSlugArg(context.args));
            const maps = yield* MapService;
            const mapId = readMapIdArg(context.args, 'mapId');
            const map = yield* maps.load(projectId, mapId);
            const layers = map.layers.map((layer) => ({
              kind: layer._tag,
              id: layer.id,
              name: layer.name,
              chunks: layer._tag === 'tile' || layer._tag === 'collision' ? layer.chunks.length : 0,
              assetId: layer._tag === 'image' ? layer.assetId : undefined,
            }));
            const assetReferences = map.layers
              .filter((layer) => layer._tag === 'image')
              .map((layer) => layer.assetId);
            return {
              mapId: map.id,
              size: map.size,
              layerCount: map.layers.length,
              chunkCount: layers.reduce((sum, layer) => sum + layer.chunks, 0),
              objectCount: map.objects.length,
              layers,
              assetReferences,
            };
          }),
        );
      },
    },
    generate: {
      meta: { name: 'generate', description: 'Generate a new map from a template' },
      args: {
        ...globalArgs,
        slug: {
          type: 'positional' as const,
          description: 'Map slug stored in properties (defaults to --preset)',
          required: false,
        },
        width: { type: 'string' as const, description: 'Map width in tiles', default: '32' },
        height: { type: 'string' as const, description: 'Map height in tiles', default: '32' },
        template: {
          type: 'string' as const,
          description: 'empty|grid|biome (alias: --preset)',
          default: 'empty',
        },
        preset: { type: 'string' as const, description: 'Alias for --template', required: false },
        project: { type: 'string' as const, description: 'Project slug', required: false },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const projectId = yield* resolveProjectId(readProjectSlugArg(context.args));
            const maps = yield* MapService;
            const slug = readStringArg(context.args, 'slug') ?? readTemplateArg(context.args);
            const width = Number.parseInt(readStringArg(context.args, 'width') ?? '32', 10);
            const height = Number.parseInt(readStringArg(context.args, 'height') ?? '32', 10);
            const template = readTemplateArg(context.args);
            if (!slug) {
              yield* Effect.fail(new CliValidationError({ message: 'map slug is required' }));
            }
            const mapId = yield* maps.create(projectId, {
              width,
              height,
              properties: { slug: slug as string },
            });
            const generated = makeTileborneMap({
              id: mapId,
              width,
              height,
              tileWidth: 32,
              tileHeight: 32,
              layers: makeTemplateLayers(template, width, height),
              properties: { slug: slug as string },
            });
            yield* maps.save(projectId, generated);
            return { mapId, slug, template, width, height };
          }),
        );
      },
    },
    'import-tiled': {
      meta: {
        name: 'import-tiled',
        description: 'Import a Tiled TMJ or TMX map into the active project',
      },
      args: {
        ...globalArgs,
        file: {
          type: 'positional' as const,
          description: 'Tiled JSON or TMX file',
          required: true,
        },
        profile: {
          type: 'string' as const,
          description: 'standard|standard-plus-hints',
          default: 'standard',
        },
        project: { type: 'string' as const, description: 'Project slug', required: false },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const file = readStringArg(context.args, 'file');
            if (!file) {
              yield* Effect.fail(
                new CliValidationError({ message: 'tiled file path is required' }),
              );
            }
            const projectId = yield* resolveProjectId(readProjectSlugArg(context.args));
            const maps = yield* MapService;
            return yield* maps.importFromTiledFile(projectId, file as string, {
              profile: readTiledProfileArg(context.args),
            });
          }),
        );
      },
    },
  },
};
