// @vitest-environment node

import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';

import { findE2eIsolationConfig } from './e2e-isolation-config.js';

const tempRoot = os.tmpdir();
const root = path.join(tempRoot, 'tileborne-desktop-release-test');
const execPath = path.join(root, 'Applications', 'Tileborne.app', 'Contents', 'MacOS', 'Tileborne');
const appPath = path.join(root, 'Applications', 'Tileborne.app', 'Contents', 'Resources', 'app');
const capabilityPath = path.join(
  root,
  'Applications',
  'Tileborne.app',
  'Contents',
  'Resources',
  'tileborne-desktop-update-oracle-capability.json',
);
const nonce = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const configPath = path.join(root, '.tileborne-e2e-isolation.json');
const scopedConfig = {
  nonce,
  userDataDir: path.join(root, 'user-data-create'),
  appDataDir: path.join(root, 'app-data'),
  quitAfterStartupMarker: path.join(root, 'shipit-relaunch-quit-after-startup'),
};
const capability = `${JSON.stringify({ schemaVersion: 1, nonce })}\n`;

const memoryFs = (files: Readonly<Record<string, string>> = {}) => {
  const written = new Map<string, string>();
  const directories = new Set([
    tempRoot,
    root,
    path.dirname(scopedConfig.userDataDir),
    scopedConfig.userDataDir,
    scopedConfig.appDataDir,
    path.dirname(scopedConfig.quitAfterStartupMarker),
    path.dirname(configPath),
    path.dirname(capabilityPath),
  ]);
  return {
    written,
    fs: {
      existsSync: (filePath: string) => Object.hasOwn(files, filePath),
      realpathSync: (filePath: string) => {
        if (directories.has(filePath) || Object.hasOwn(files, filePath)) {
          return filePath;
        }
        throw new Error(`missing fixture path: ${filePath}`);
      },
      readFileSync: (filePath: string) => {
        const bytes = files[filePath];
        if (bytes === undefined) {
          throw new Error(`missing fixture file: ${filePath}`);
        }
        return bytes;
      },
      mkdirSync: () => undefined,
      writeFileSync: (filePath: string, bytes: string) => {
        written.set(filePath, bytes);
      },
    },
  };
};

describe('findE2eIsolationConfig', () => {
  it('ignores forged ancestor config during ordinary packaged launches', () => {
    const { fs } = memoryFs({ [configPath]: `${JSON.stringify(scopedConfig)}\n` });

    expect(findE2eIsolationConfig({ appPath, env: {}, execPath, fs })).toBeUndefined();
  });

  it('ignores E2E config without a signed oracle capability resource', () => {
    const { fs } = memoryFs({ [configPath]: `${JSON.stringify(scopedConfig)}\n` });

    expect(
      findE2eIsolationConfig({ appPath, env: { TILEBORNE_E2E: '1' }, execPath, fs }),
    ).toBeUndefined();
  });

  it('ignores malformed ancestor config instead of throwing', () => {
    const { fs } = memoryFs({ [capabilityPath]: capability, [configPath]: '{not json' });

    expect(
      findE2eIsolationConfig({ appPath, env: { TILEBORNE_E2E: '1' }, execPath, fs }),
    ).toBeUndefined();
  });

  it('continues ancestor search when reading a nearer config throws EISDIR', () => {
    const nearerDirectory = path.dirname(execPath);
    const nearerConfigPath = path.join(nearerDirectory, '.tileborne-e2e-isolation.json');
    const { fs } = memoryFs({
      [capabilityPath]: capability,
      [nearerConfigPath]: '',
      [configPath]: `${JSON.stringify(scopedConfig)}\n`,
    });

    expect(
      findE2eIsolationConfig({
        appPath,
        env: {},
        execPath,
        fs: {
          ...fs,
          realpathSync: (filePath: string) => {
            if (filePath === nearerDirectory || filePath === path.dirname(nearerDirectory)) {
              return filePath;
            }
            return fs.realpathSync(filePath);
          },
          readFileSync: (filePath: string) => {
            if (filePath === nearerConfigPath) {
              throw Object.assign(new Error('is a directory'), { code: 'EISDIR' });
            }
            return fs.readFileSync(filePath);
          },
        },
      }),
    ).toEqual(scopedConfig);
  });

  it('continues ancestor search when reading a nearer config throws EACCES', () => {
    const nearerDirectory = path.dirname(execPath);
    const nearerConfigPath = path.join(nearerDirectory, '.tileborne-e2e-isolation.json');
    const { fs } = memoryFs({
      [capabilityPath]: capability,
      [nearerConfigPath]: '',
      [configPath]: `${JSON.stringify(scopedConfig)}\n`,
    });

    expect(
      findE2eIsolationConfig({
        appPath,
        env: {},
        execPath,
        fs: {
          ...fs,
          realpathSync: (filePath: string) => {
            if (filePath === nearerDirectory || filePath === path.dirname(nearerDirectory)) {
              return filePath;
            }
            return fs.realpathSync(filePath);
          },
          readFileSync: (filePath: string) => {
            if (filePath === nearerConfigPath) {
              throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
            }
            return fs.readFileSync(filePath);
          },
        },
      }),
    ).toEqual(scopedConfig);
  });

  it('continues ancestor search when a nearer config disappears after existsSync', () => {
    const nearerDirectory = path.dirname(execPath);
    const nearerConfigPath = path.join(nearerDirectory, '.tileborne-e2e-isolation.json');
    const { fs } = memoryFs({
      [capabilityPath]: capability,
      [nearerConfigPath]: '',
      [configPath]: `${JSON.stringify(scopedConfig)}\n`,
    });

    expect(
      findE2eIsolationConfig({
        appPath,
        env: {},
        execPath,
        fs: {
          ...fs,
          realpathSync: (filePath: string) => {
            if (filePath === nearerDirectory || filePath === path.dirname(nearerDirectory)) {
              return filePath;
            }
            return fs.realpathSync(filePath);
          },
          readFileSync: (filePath: string) => {
            if (filePath === nearerConfigPath) {
              throw Object.assign(new Error('no such file or directory'), { code: 'ENOENT' });
            }
            return fs.readFileSync(filePath);
          },
        },
      }),
    ).toEqual(scopedConfig);
  });

  it('ignores config with a mismatched nonce', () => {
    const { fs } = memoryFs({
      [capabilityPath]: capability,
      [configPath]: `${JSON.stringify({ ...scopedConfig, nonce: 'f'.repeat(64) })}\n`,
    });

    expect(
      findE2eIsolationConfig({ appPath, env: { TILEBORNE_E2E: '1' }, execPath, fs }),
    ).toBeUndefined();
  });

  it('ignores ancestor config with paths outside the verifier isolation root', () => {
    const { fs } = memoryFs({
      [capabilityPath]: capability,
      [configPath]: `${JSON.stringify({
        ...scopedConfig,
        quitAfterStartupMarker: path.join(tempRoot, 'owned-by-user'),
      })}\n`,
    });

    expect(
      findE2eIsolationConfig({ appPath, env: { TILEBORNE_E2E: '1' }, execPath, fs }),
    ).toBeUndefined();
  });

  it('ignores ancestor config whose realpath escapes through a symlink', () => {
    const linkedUserData = path.join(root, 'linked-user-data');
    const { fs } = memoryFs({
      [capabilityPath]: capability,
      [configPath]: `${JSON.stringify({
        ...scopedConfig,
        userDataDir: linkedUserData,
      })}\n`,
      [linkedUserData]: '',
    });

    expect(
      findE2eIsolationConfig({
        appPath,
        env: { TILEBORNE_E2E: '1' },
        execPath,
        fs: {
          ...fs,
          realpathSync: (filePath: string) => {
            if (filePath === linkedUserData) return path.join(tempRoot, 'owned-by-user');
            return fs.realpathSync(filePath);
          },
        },
      }),
    ).toBeUndefined();
  });

  it('ignores ancestor config rooted outside the verifier temp-root namespace', () => {
    const unscopedRoot = path.join(tempRoot, 'not-tileborne-release');
    const unscopedExecPath = path.join(
      unscopedRoot,
      'Applications',
      'Tileborne.app',
      'Contents',
      'MacOS',
      'Tileborne',
    );
    const unscopedConfigPath = path.join(unscopedRoot, '.tileborne-e2e-isolation.json');
    const unscopedConfig = {
      nonce,
      userDataDir: path.join(unscopedRoot, 'user-data-create'),
      appDataDir: path.join(unscopedRoot, 'app-data'),
      quitAfterStartupMarker: path.join(unscopedRoot, 'shipit-relaunch-quit-after-startup'),
    };
    const { fs } = memoryFs({
      [capabilityPath]: capability,
      [unscopedConfigPath]: `${JSON.stringify(unscopedConfig)}\n`,
    });

    expect(
      findE2eIsolationConfig({
        appPath,
        env: { TILEBORNE_E2E: '1' },
        execPath: unscopedExecPath,
        fs: {
          ...fs,
          realpathSync: (filePath: string) => {
            if (filePath.startsWith(unscopedRoot)) return filePath;
            return fs.realpathSync(filePath);
          },
        },
      }),
    ).toBeUndefined();
  });

  it('accepts scoped ancestor config for E2E ShipIt relaunches', () => {
    const { fs } = memoryFs({
      [capabilityPath]: capability,
      [configPath]: `${JSON.stringify(scopedConfig)}\n`,
    });

    expect(findE2eIsolationConfig({ appPath, env: {}, execPath, fs })).toEqual(scopedConfig);
  });

  it('writes and returns only environment config scoped to the configured root', () => {
    const { fs, written } = memoryFs({ [capabilityPath]: capability });

    expect(
      findE2eIsolationConfig({
        appPath,
        env: {
          TILEBORNE_E2E: '1',
          TILEBORNE_E2E_ISOLATION_CONFIG: configPath,
          TILEBORNE_E2E_ISOLATION_NONCE: nonce,
          TILEBORNE_E2E_USER_DATA_DIR: scopedConfig.userDataDir,
          TILEBORNE_E2E_APP_DATA_DIR: scopedConfig.appDataDir,
          TILEBORNE_E2E_QUIT_AFTER_STARTUP_MARKER: scopedConfig.quitAfterStartupMarker,
        },
        execPath,
        fs,
      }),
    ).toEqual(scopedConfig);
    expect(written.get(configPath)).toBe(`${JSON.stringify(scopedConfig)}\n`);
  });

  it('rejects environment config outside the configured root', () => {
    const { fs, written } = memoryFs({ [capabilityPath]: capability });

    expect(
      findE2eIsolationConfig({
        appPath,
        env: {
          TILEBORNE_E2E: '1',
          TILEBORNE_E2E_ISOLATION_CONFIG: configPath,
          TILEBORNE_E2E_ISOLATION_NONCE: nonce,
          TILEBORNE_E2E_USER_DATA_DIR: scopedConfig.userDataDir,
          TILEBORNE_E2E_APP_DATA_DIR: scopedConfig.appDataDir,
          TILEBORNE_E2E_QUIT_AFTER_STARTUP_MARKER: path.join(tempRoot, 'owned-by-user'),
        },
        execPath,
        fs,
      }),
    ).toBeUndefined();
    expect(written.size).toBe(0);
  });
});
