import path from 'node:path';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { CliUsageError } from '../render/errors.js';
import { parseNpmPluginSpec, resolvePluginInstallSource } from './plugin-source.js';

describe('parseNpmPluginSpec', () => {
  it('parses a scoped package with version', () => {
    const source = parseNpmPluginSpec('@tileborne-plugins/demo@1.2.3');
    expect(source._tag).toBe('npm');
    if (source._tag === 'npm') {
      expect(source.packageName).toBe('@tileborne-plugins/demo');
      expect(source.version).toEqual(Option.some('1.2.3'));
    }
  });

  it('parses an unscoped package without version', () => {
    const source = parseNpmPluginSpec('demo-plugin');
    expect(source._tag).toBe('npm');
    if (source._tag === 'npm') {
      expect(source.packageName).toBe('demo-plugin');
      expect(source.version).toEqual(Option.none());
    }
  });

  it('rejects invalid npm-like specs', () => {
    expect(() => parseNpmPluginSpec('bad/spec/extra')).toThrow(CliUsageError);
  });
});

describe('resolvePluginInstallSource', () => {
  it('resolves a local directory source to an absolute path', () => {
    const source = resolvePluginInstallSource({ local: '.' });
    expect(source._tag).toBe('local');
    if (source._tag === 'local') {
      expect(source.path).toBe(path.resolve('.'));
    }
  });

  it('rejects multiple install source flags', () => {
    expect(() => resolvePluginInstallSource({ local: '.', tarball: '/tmp/plugin.tbpack' })).toThrow(
      CliUsageError,
    );
  });

  it('requires a source flag or spec', () => {
    expect(() => resolvePluginInstallSource({})).toThrow(CliUsageError);
  });

  it('decodes tarball integrity as a content hash', () => {
    const digest = 'a'.repeat(64);
    const source = resolvePluginInstallSource({
      tarball: '/tmp/plugin.tbpack',
      integrity: `sha256:${digest}`,
    });
    expect(source._tag).toBe('tarball');
    if (source._tag === 'tarball') {
      expect(source.integrity).toEqual(Option.some(`sha256:${digest}`));
    }
  });
});
