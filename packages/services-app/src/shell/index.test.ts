import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  defaultProjectGameShellState,
  projectGameShellDocumentFromState,
  type GameShellDefaultsDefinition,
} from '@tileborne/runtime';

import { ProjectService, ServicesAppLayer } from '../index.js';
import { withTempHome } from '../test-utils.js';
import { ProjectGameShellService } from './index.js';

const runApp = <A, E>(effect: Effect.Effect<A, E, ProjectService | ProjectGameShellService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(ServicesAppLayer)));

const arenaDefaults = (pluginId: string, title: string): GameShellDefaultsDefinition => {
  const state = defaultProjectGameShellState(pluginId);
  return {
    pluginId,
    screens: Object.values({
      ...state.screensById,
      title: { ...state.screensById.title!, title },
    }),
    screenOrder: state.screenOrder,
    tokens: state.tokens,
    entryScreenId: state.entryScreenId,
  };
};

describe('ProjectGameShellService', () => {
  it('opens plugin defaults and saves/reopens durable project overrides', () =>
    withTempHome(async () => {
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const shell = yield* ProjectGameShellService;
          const projectId = yield* projects.create({ name: 'Shell Project' });
          const defaults = arenaDefaults('plugin:one', 'Plugin One');
          const opened = yield* shell.open(projectId, { defaults });
          const edited = yield* shell.apply(
            projectId,
            {
              type: 'set-screen-text',
              screenId: 'title',
              title: 'Project Override',
              subtitle: 'Persist me',
            },
            { defaults },
          );
          const reopened = yield* shell.open(projectId, { defaults });
          return { opened, edited: edited.document, reopened };
        }),
      );

      expect(result.opened.screens.find((screen) => screen.id === 'title')?.title).toBe(
        'Plugin One',
      );
      expect(result.edited.projectOverrides).toHaveLength(1);
      expect(result.reopened.screens.find((screen) => screen.id === 'title')).toMatchObject({
        title: 'Project Override',
        subtitle: 'Persist me',
      });
    }));

  it('keeps distinct plugin defaults while persisted project overrides remain explicit overlays', () =>
    withTempHome(async () => {
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const shell = yield* ProjectGameShellService;
          const projectId = yield* projects.create({ name: 'Two Plugins' });
          const first = arenaDefaults('plugin:first', 'First Defaults');
          const second = arenaDefaults('plugin:second', 'Second Defaults');
          const firstOpen = yield* shell.open(projectId, { defaults: first });
          yield* shell.apply(
            projectId,
            {
              type: 'set-screen-layout',
              screenId: 'title',
              layout: 'split',
            },
            { defaults: first },
          );
          const secondOpen = yield* shell.open(projectId, { defaults: second });
          return { firstOpen, secondOpen };
        }),
      );

      expect(result.firstOpen.screens.find((screen) => screen.id === 'title')?.title).toBe(
        'First Defaults',
      );
      expect(result.secondOpen.screens.find((screen) => screen.id === 'title')).toMatchObject({
        title: 'Second Defaults',
        layout: 'split',
      });
      expect(result.secondOpen.projectOverrides?.map((command) => command.type)).toEqual([
        'set-screen-layout',
      ]);
    }));

  it('persists command-created asset-pack refs and blocks stale installed assets in projection', () =>
    withTempHome(async () => {
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const shell = yield* ProjectGameShellService;
          const projectId = yield* projects.create({ name: 'Assets' });
          yield* shell.apply(projectId, {
            type: 'register-asset',
            asset: {
              assetId: 'asset:bg',
              packId: 'pack:ui',
              packVersion: '1.0.0',
              path: 'assets/title.png',
              mime: 'image/png',
              kind: 'background',
            },
          });
          yield* shell.apply(projectId, {
            type: 'set-screen-asset',
            screenId: 'title',
            slot: 'background',
            assetId: 'asset:bg',
          });
          const project = yield* projects.open(projectId);
          const projection = yield* shell.project(projectId, {
            projection: {
              resolveAsset: (asset) => ({
                ok: asset.path === 'assets/renamed.png',
                message: `Missing installed asset ${asset.assetId}`,
              }),
            },
          });
          return { project, projection };
        }),
      );

      expect(result.project.assetPacks).toContainEqual({ id: 'pack:ui', version: '1.0.0' });
      expect(result.projection.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'missing-asset',
          path: 'shell.screens.title.backgroundAssetId',
          message: 'Missing installed asset asset:bg',
        }),
      );
    }));

  it('saves and reopens explicit documents without losing asset-pack refs', () =>
    withTempHome(async () => {
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const shell = yield* ProjectGameShellService;
          const projectId = yield* projects.create({ name: 'Save Reopen' });
          const state = {
            ...defaultProjectGameShellState('plugin:save'),
            assetsById: {
              'asset:font': {
                assetId: 'asset:font',
                packId: 'pack:fonts',
                packVersion: '2.0.0',
                path: 'fonts/free.woff2',
                mime: 'font/woff2',
                kind: 'font' as const,
              },
            },
          };
          const saved = yield* shell.save(projectId, projectGameShellDocumentFromState(state));
          const reopened = yield* shell.open(projectId);
          const project = yield* projects.open(projectId);
          return { saved, reopened, project };
        }),
      );

      expect(result.saved.pluginId).toBe('plugin:save');
      expect(result.reopened.assets.map((asset) => asset.assetId)).toEqual(['asset:font']);
      expect(result.project.assetPacks).toContainEqual({ id: 'pack:fonts', version: '2.0.0' });
    }));
});
