import { describe, expect, it } from 'vitest';

import {
  applyAudioAuthoringCommand,
  buildRuntimeAudioCuesFromAuthoring,
  createAudioAuthoringState,
  decodeProjectAudioDocument,
  defaultRuntimeAudioSettings,
  projectAudioDocumentFromState,
} from './index.js';

const emptyState = () =>
  createAudioAuthoringState({
    settings: defaultRuntimeAudioSettings(),
  });

describe('audio authoring contract', () => {
  it('imports, previews, classifies, binds, replaces, and removes by stable labels', () => {
    const imported = applyAudioAuthoringCommand(emptyState(), {
      type: 'import',
      label: 'Rifle Shot',
      classification: 'weapon',
      source: {
        assetId: 'asset:rifle-shot',
        path: 'assets/audio/rifle-shot.ogg',
        mime: 'audio/ogg',
      },
    });
    expect(imported.diagnostics).toEqual([]);
    expect(imported.state.assetsByLabel['Rifle Shot']?.source.path).toBe(
      'assets/audio/rifle-shot.ogg',
    );

    const previewed = applyAudioAuthoringCommand(imported.state, {
      type: 'preview',
      label: 'Rifle Shot',
    });
    expect(previewed.effects).toEqual([
      {
        type: 'preview',
        label: 'Rifle Shot',
        source: {
          assetId: 'asset:rifle-shot',
          path: 'assets/audio/rifle-shot.ogg',
          mime: 'audio/ogg',
        },
      },
    ]);

    const classified = applyAudioAuthoringCommand(previewed.state, {
      type: 'classify',
      label: 'Rifle Shot',
      classification: 'match',
    });
    expect(classified.state.assetsByLabel['Rifle Shot']?.classification).toBe('match');

    const rebound = applyAudioAuthoringCommand(classified.state, {
      type: 'bind',
      binding: 'weapon.fire',
      label: 'Rifle Shot',
    });
    expect(rebound.state.bindings['weapon.fire']).toBe('Rifle Shot');

    const replaced = applyAudioAuthoringCommand(rebound.state, {
      type: 'replace',
      label: 'Rifle Shot',
      source: { assetId: 'asset:rifle-shot-v2', path: 'assets/audio/rifle-shot-v2.ogg' },
    });
    expect(replaced.state.assetsByLabel['Rifle Shot']?.source.assetId).toBe('asset:rifle-shot-v2');

    const removed = applyAudioAuthoringCommand(replaced.state, {
      type: 'remove',
      label: 'Rifle Shot',
    });
    expect(removed.state.assetsByLabel['Rifle Shot']).toBeUndefined();
    expect(removed.state.bindings['weapon.fire']).toBeUndefined();
  });

  it('materializes representative typed bindings into packaged runtime cues', () => {
    let state = emptyState();
    for (const [binding, label] of [
      ['shell.menuMusic', 'Menu Loop'],
      ['weapon.fire', 'Rifle Shot'],
      ['item.collect', 'Loot Pickup'],
      ['player.hit', 'Player Hit'],
      ['environment.zoneWarning', 'Zone Warning'],
      ['match.end', 'Victory Sting'],
    ] as const) {
      state = applyAudioAuthoringCommand(state, {
        type: 'import',
        label,
        classification: binding.startsWith('shell.') ? 'music' : 'sfx',
        source: { url: `assets/audio/${label.toLowerCase().replaceAll(' ', '-')}.ogg` },
      }).state;
      state = applyAudioAuthoringCommand(state, { type: 'bind', binding, label }).state;
    }

    const built = buildRuntimeAudioCuesFromAuthoring(state);

    expect(built.cues.map((cue) => [cue.binding, cue.label, cue.source?.url])).toEqual([
      ['shell.menuMusic', 'Menu Loop', 'assets/audio/menu-loop.ogg'],
      ['weapon.fire', 'Rifle Shot', 'assets/audio/rifle-shot.ogg'],
      ['item.collect', 'Loot Pickup', 'assets/audio/loot-pickup.ogg'],
      ['player.hit', 'Player Hit', 'assets/audio/player-hit.ogg'],
      ['environment.zoneWarning', 'Zone Warning', 'assets/audio/zone-warning.ogg'],
      ['match.end', 'Victory Sting', 'assets/audio/victory-sting.ogg'],
    ]);
    expect(built.cues.find((cue) => cue.binding === 'shell.menuMusic')?.loop).toBe(true);
    expect(built.cues.find((cue) => cue.binding === 'weapon.fire')?.maxOverlap).toBe(4);
  });

  it('reports missing labels, sources, and unbound binding diagnostics without side effects', () => {
    const previewMissing = applyAudioAuthoringCommand(emptyState(), {
      type: 'preview',
      label: 'Missing',
    });
    expect(previewMissing.effects).toEqual([]);
    expect(previewMissing.diagnostics[0]).toMatchObject({ code: 'missing-label' });

    const importedMissingSource = applyAudioAuthoringCommand(emptyState(), {
      type: 'import',
      label: 'No File',
      classification: 'environment',
      source: {},
    });
    expect(importedMissingSource.diagnostics[0]).toMatchObject({ code: 'missing-source' });

    const built = buildRuntimeAudioCuesFromAuthoring(importedMissingSource.state);
    expect(built.diagnostics.some((diagnostic) => diagnostic.code === 'unbound-binding')).toBe(
      true,
    );
  });

  it('validates durable audio documents instead of accepting arbitrary keys and gains', () => {
    const valid = projectAudioDocumentFromState(
      applyAudioAuthoringCommand(
        applyAudioAuthoringCommand(emptyState(), {
          type: 'import',
          label: 'Menu Loop',
          classification: 'music',
          source: { path: 'assets/audio/menu-loop.ogg', mime: 'audio/ogg' },
        }).state,
        { type: 'bind', binding: 'shell.menuMusic', label: 'Menu Loop' },
      ).state,
    );

    expect(decodeProjectAudioDocument(JSON.parse(JSON.stringify(valid)))).toBeDefined();
    expect(
      decodeProjectAudioDocument({
        ...valid,
        bindings: { 'unknown.binding': 'Menu Loop' },
      }),
    ).toBeUndefined();
    expect(
      decodeProjectAudioDocument({
        ...valid,
        settings: { ...valid.settings, masterVolume: 1.5 },
      }),
    ).toBeUndefined();
    expect(
      decodeProjectAudioDocument({
        ...valid,
        assets: [{ label: '', classification: 'music', source: {} }],
      }),
    ).toBeUndefined();
    expect(
      decodeProjectAudioDocument({
        ...valid,
        assets: [
          {
            label: 'Bad URL',
            classification: 'music',
            source: { url: 'data:audio/ogg;base64,T2dnUw==', path: 'assets/audio/menu.ogg' },
          },
        ],
      }),
    ).toBeUndefined();
    expect(
      decodeProjectAudioDocument({
        ...valid,
        assets: [
          {
            label: 'Bad Asset',
            classification: 'sfx',
            source: { assetId: 'asset:missing-path', mime: 'audio/ogg' },
          },
        ],
      }),
    ).toBeUndefined();
    expect(
      decodeProjectAudioDocument({
        ...valid,
        assets: [
          {
            label: 'Bad Mime',
            classification: 'sfx',
            source: { path: 'assets/audio/menu.png', mime: 'image/png' },
          },
        ],
      }),
    ).toBeUndefined();
  });
});
