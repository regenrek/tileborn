import { describe, expect, it } from 'vitest';

import { resolveExternalLevel } from '../external-resolve.js';

const noopReader = () => ({ ok: false as const, reason: 'not used' });

describe('resolveExternalLevel', () => {
  it('rejects absolute external refs for a bare project filename', () => {
    const result = resolveExternalLevel({
      projectPath: 'world.ldtk',
      externalRelPath: '/outside/link.ldtkl',
      readFile: noopReader,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic._tag).toBe('LdtkExternalRefBlocked');
    }
  });

  it('rejects an empty project path', () => {
    const result = resolveExternalLevel({
      projectPath: '',
      externalRelPath: 'levels/External.ldtkl',
      readFile: noopReader,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic._tag).toBe('LdtkExternalRefBlocked');
      expect(result.diagnostic.message).toContain('empty');
    }
  });

  it('rejects escape attempts when the project path is relative to cwd', () => {
    const result = resolveExternalLevel({
      projectPath: '.',
      externalRelPath: '../outside/Secret.ldtkl',
      readFile: noopReader,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic._tag).toBe('LdtkExternalRefBlocked');
    }
  });

  it('rejects prefix-substring roots that do not end on a path separator', () => {
    const result = resolveExternalLevel({
      projectPath: '/work/proj/world.ldtk',
      externalRelPath: 'levels/Outside.ldtkl',
      readFile: noopReader,
      realpath: () => '/work/projectile.ldtkl',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic._tag).toBe('LdtkExternalRefBlocked');
      expect(result.diagnostic.resolvedPath).toBe('/work/projectile.ldtkl');
    }
  });

  it('rejects realpath escapes outside the anchored project root', () => {
    const projectRoot = '/tmp/ldtk-project';
    const result = resolveExternalLevel({
      projectPath: `${projectRoot}/world.ldtk`,
      externalRelPath: 'levels/Linked.ldtkl',
      readFile: noopReader,
      realpath: (absolutePath) =>
        absolutePath.endsWith('Linked.ldtkl') ? '/outside/Linked.ldtkl' : absolutePath,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic._tag).toBe('LdtkExternalRefBlocked');
      expect(result.diagnostic.resolvedPath).toBe('/outside/Linked.ldtkl');
    }
  });

  it('does not invoke readFile when containment blocks the external level', () => {
    let readCount = 0;
    const result = resolveExternalLevel({
      projectPath: 'world.ldtk',
      externalRelPath: 'levels/Outside.ldtkl',
      readFile: () => {
        readCount += 1;
        return { ok: true, text: '{}' };
      },
      realpath: () => '/outside/Outside.ldtkl',
    });

    expect(result.ok).toBe(false);
    expect(readCount).toBe(0);
  });
});
