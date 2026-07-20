import { makeProjectId } from '@tileborne/core';
import type { InstalledPlugin } from '@tileborne/services-plugin';
import type { GameModeDescriptor } from '@tileborne/plugin-api';
import {
  defaultProjectGameShellState,
  projectGameShellDocumentFromState,
  type ProjectGameShellDocument,
} from '@tileborne/runtime';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  gameShellDefaultsInvalidReadinessDiagnostic,
  resolveInstalledGameShellDefaults,
} from './game-shell-defaults.js';

const activeMode = {
  pluginId: 'tileborne.battle-royale',
} as GameModeDescriptor;

const installedWithShellDefaults = (data: unknown, enabled = true): InstalledPlugin =>
  ({
    id: 'tileborne.battle-royale',
    enabled,
    manifest: {
      contributes: {
        runtime: Option.some({
          shellDefaults: Option.some([
            {
              id: 'br-game-shell-defaults',
              data,
            },
          ]),
        }),
      },
    },
  }) as unknown as InstalledPlugin;

const defaultsData = (document: ProjectGameShellDocument) => ({
  screens: document.screens,
  screenOrder: document.screenOrder,
  assets: document.assets,
  tokens: document.tokens,
  entryScreenId: document.entryScreenId,
});

describe('installed game shell defaults', () => {
  it('resolves validated installed plugin defaults for the active mode', () => {
    const document = projectGameShellDocumentFromState(
      defaultProjectGameShellState('tileborne.battle-royale'),
    );

    const resolved = resolveInstalledGameShellDefaults(activeMode, [
      installedWithShellDefaults(defaultsData(document)),
    ]);

    expect(resolved.invalid).toBeUndefined();
    expect(resolved.defaults).toMatchObject({
      pluginId: 'tileborne.battle-royale',
      entryScreenId: 'title',
      screenOrder: expect.arrayContaining(['title', 'main-menu', 'results']),
    });
  });

  it('returns an actionable invalid contribution and readiness diagnostic for malformed defaults', () => {
    const document = projectGameShellDocumentFromState(
      defaultProjectGameShellState('tileborne.battle-royale'),
    );
    const resolved = resolveInstalledGameShellDefaults(activeMode, [
      installedWithShellDefaults({
        ...defaultsData(document),
        entryScreenId: 'missing-screen',
      }),
    ]);

    expect(resolved.defaults).toBeUndefined();
    expect(resolved.invalid).toEqual({
      pluginId: 'tileborne.battle-royale',
      contributionId: 'br-game-shell-defaults',
    });
    expect(
      gameShellDefaultsInvalidReadinessDiagnostic(
        makeProjectId('00000000-0000-4000-8000-000000000901'),
        resolved.invalid!,
      ),
    ).toMatchObject({
      code: 'game-shell.plugin-defaults-invalid',
      severity: 'error',
      source: 'game-shell',
      path: 'plugins.tileborne.battle-royale.runtime.shellDefaults.br-game-shell-defaults',
      navigation: {
        kind: 'project-settings',
        path: 'plugins.tileborne.battle-royale.runtime.shellDefaults.br-game-shell-defaults',
      },
    });
  });

  it('ignores disabled or inactive plugin defaults', () => {
    const document = projectGameShellDocumentFromState(
      defaultProjectGameShellState('tileborne.battle-royale'),
    );

    expect(
      resolveInstalledGameShellDefaults(activeMode, [
        installedWithShellDefaults(defaultsData(document), false),
      ]),
    ).toEqual({});
    expect(
      resolveInstalledGameShellDefaults(undefined, [
        installedWithShellDefaults(defaultsData(document)),
      ]),
    ).toEqual({});
  });
});
