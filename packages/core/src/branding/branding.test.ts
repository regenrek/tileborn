import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { BrandConfig, decodeBrandConfig } from './index.js';

/** Mirrors the product `branding/tokens.json` shape (brand-neutral fields). */
const tokens = {
  schemaVersion: 1,
  title: 'Sample Game',
  palette: {
    background: '#0b1220',
    surface: '#141c2f',
    accent: '#6ee7a8',
    accentHostile: '#f87171',
    accentFriendly: '#60a5fa',
    textPrimary: '#f8fafc',
    textMuted: '#94a3b8',
  },
  lobbyCopy: {
    tagline: 'Drop in. Last one standing wins.',
    cta: 'Play Now',
  },
  legal: {
    tos: 'https://example.invalid/terms',
    privacy: 'https://example.invalid/privacy',
  },
  servers: {
    plugin: '@tileborne-plugins/battle-royale',
    roomRules: { maxPlayers: 16, timeLimitSeconds: 600, friendlyFire: false },
    lootTable: 'default-loot',
    replays: { enabled: true, prefix: 'sample/' },
  },
  assetPackId: 'pack:22222222-2222-4222-8222-222222222222',
  mapId: 'map:33333333-3333-4333-8333-333333333333',
} as const;

describe('BrandConfig', () => {
  it('decodes a full product tokens.json shape', () => {
    const config = decodeBrandConfig(tokens);
    expect(config.title).toBe('Sample Game');
    expect(config.palette.accent).toBe('#6ee7a8');
    expect(config.servers?.plugin).toBe('@tileborne-plugins/battle-royale');
    expect(config.servers?.roomRules?.maxPlayers).toBe(16);
    expect(config.assetPackId).toBe('pack:22222222-2222-4222-8222-222222222222');
    expect(config.mapId).toBe('map:33333333-3333-4333-8333-333333333333');
  });

  it('decodes a minimal neutral config (no optional fields)', () => {
    const config = decodeBrandConfig({
      title: 'Tileborne Game',
      palette: tokens.palette,
      lobbyCopy: { tagline: '', cta: 'Play' },
    });
    expect(config.title).toBe('Tileborne Game');
    expect(config.logo).toBeUndefined();
    expect(config.servers).toBeUndefined();
    expect(config.menuExtensions).toBeUndefined();
  });

  it('decodes product-only menu extensions into named slots', () => {
    const config = decodeBrandConfig({
      title: 'Tileborne Game',
      palette: tokens.palette,
      lobbyCopy: { tagline: 't', cta: 'Play' },
      menuExtensions: [
        { id: 'account', slot: 'main.secondaryActions', label: 'Account', order: 10 },
        { id: 'leaderboard', slot: 'main.tabs', label: 'Leaderboard' },
      ],
    });
    expect(config.menuExtensions?.map((e) => e.id)).toEqual(['account', 'leaderboard']);
  });

  it('rejects an empty title', () => {
    expect(() =>
      decodeBrandConfig({
        title: '',
        palette: tokens.palette,
        lobbyCopy: { tagline: '', cta: '' },
      }),
    ).toThrow();
  });

  it('rejects a malformed plugin id in servers', () => {
    expect(() =>
      Schema.decodeUnknownSync(BrandConfig)({
        title: 'Game',
        palette: tokens.palette,
        lobbyCopy: { tagline: '', cta: '' },
        servers: { plugin: 'not a valid plugin id' },
      }),
    ).toThrow();
  });
});
