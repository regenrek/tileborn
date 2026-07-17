import {
  CORE_HUD_WIDGETS,
  HudLayout,
  makeProjectId,
  makeProjectManifest,
  type ProjectManifest,
} from '@tileborne/core';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  PROJECT_HUD_LAYOUT_SETTINGS_KEY,
  clearProjectHudLayout,
  readProjectHudLayout,
  writeProjectHudLayout,
} from './project-hud-layout';

const sampleProject = (): ProjectManifest =>
  makeProjectManifest({
    id: makeProjectId('550e8400-e29b-41d4-a716-446655440030'),
    name: 'Hud Demo',
  });

const sampleLayout = (): HudLayout =>
  Schema.decodeUnknownSync(HudLayout)({
    id: 'project-hud',
    widgets: [
      {
        id: 'minimap',
        kind: CORE_HUD_WIDGETS.Minimap,
        anchor: 'bottom-right',
        order: 0,
        enabled: true,
        offset: { x: -12, y: -12 },
      },
    ],
  });

describe('project-hud-layout', () => {
  it('returns undefined when the project has no stored layout', () => {
    expect(readProjectHudLayout(sampleProject())).toBeUndefined();
    expect(readProjectHudLayout(undefined)).toBeUndefined();
  });

  it('round-trips a layout through the project settings bag', () => {
    const written = writeProjectHudLayout(sampleProject(), sampleLayout());
    const read = readProjectHudLayout(written);
    expect(read?.id).toBe('project-hud');
    expect(read?.widgets).toHaveLength(1);
    expect(read?.widgets[0]?.anchor).toBe('bottom-right');
  });

  it('persists the canonical encoded HudLayout bytes under one settings key', () => {
    const written = writeProjectHudLayout(sampleProject(), sampleLayout());
    const stored = written.settings?.[PROJECT_HUD_LAYOUT_SETTINGS_KEY];
    expect(stored).toEqual(Schema.encodeUnknownSync(HudLayout)(sampleLayout()));
  });

  it('preserves unrelated settings when writing and clearing', () => {
    const base = makeProjectManifest({
      id: makeProjectId('550e8400-e29b-41d4-a716-446655440031'),
      name: 'Hud Demo',
    });
    const withMode = { ...base, settings: { activeGameMode: 'some-mode' } };
    const written = writeProjectHudLayout(withMode as ProjectManifest, sampleLayout());
    expect(written.settings?.activeGameMode).toBe('some-mode');
    const cleared = clearProjectHudLayout(written);
    expect(cleared.settings?.activeGameMode).toBe('some-mode');
    expect(cleared.settings?.[PROJECT_HUD_LAYOUT_SETTINGS_KEY]).toBeUndefined();
    expect(readProjectHudLayout(cleared)).toBeUndefined();
  });

  it('treats a corrupt stored value as absent instead of throwing', () => {
    const corrupt = {
      ...sampleProject(),
      settings: { [PROJECT_HUD_LAYOUT_SETTINGS_KEY]: { nope: true } },
    };
    expect(readProjectHudLayout(corrupt as unknown as ProjectManifest)).toBeUndefined();
  });
});
