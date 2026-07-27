import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  DesktopUpdatePolicy,
  DesktopUpdateReceipt,
  DesktopUpdateState,
  DesktopUpdatesCheckContract,
  DesktopUpdatesGetStateContract,
  DesktopUpdatesRestartContract,
  MainIpcRegistry,
} from './index.js';
import { MainEventRegistry } from '../events.js';

const decode = (schema: Schema.Top, value: unknown) => Schema.decodeUnknownSync(schema)(value);

describe('desktop update IPC contract', () => {
  it('registers only main-owned updater commands and state events', () => {
    expect(MainIpcRegistry.byChannel['tileborne:desktop-updates:getState']).toBe(
      DesktopUpdatesGetStateContract,
    );
    expect(MainIpcRegistry.byChannel['tileborne:desktop-updates:check']).toBe(
      DesktopUpdatesCheckContract,
    );
    expect(MainIpcRegistry.byChannel['tileborne:desktop-updates:restart']).toBe(
      DesktopUpdatesRestartContract,
    );
    expect(MainEventRegistry.byChannel['tileborne:desktop-updates:stateChanged'].channel).toBe(
      'tileborne:desktop-updates:stateChanged',
    );
  });

  it('locks production feed policy to the public macOS arm64 release channel', () => {
    expect(
      decode(DesktopUpdatePolicy, {
        owner: 'regenrek',
        repository: 'tileborn',
        channel: 'github-release',
        feedBaseUrl: 'https://update.electronjs.org',
        feedUrl: 'https://update.electronjs.org/regenrek/tileborn/darwin-arm64/1.0.0',
        platform: 'darwin',
        architecture: 'arm64',
        bundleId: 'dev.tileborne.app',
        expectedTeamIdentifierEnvironment: 'TILEBORNE_APPLE_TEAM_ID',
      }),
    ).toBeDefined();

    expect(() =>
      decode(DesktopUpdatePolicy, {
        owner: 'someone-else',
        repository: 'tileborn',
        channel: 'github-release',
        feedBaseUrl: 'https://update.electronjs.org',
        feedUrl: 'https://update.electronjs.org/someone-else/tileborn/darwin-arm64/1.0.0',
        platform: 'darwin',
        architecture: 'arm64',
        bundleId: 'dev.tileborne.app',
        expectedTeamIdentifierEnvironment: 'TILEBORNE_APPLE_TEAM_ID',
      }),
    ).toThrow();
  });

  it('does not accept renderer feed injection or artifact path inputs', () => {
    for (const contract of [
      DesktopUpdatesGetStateContract,
      DesktopUpdatesCheckContract,
      DesktopUpdatesRestartContract,
    ]) {
      expect(decode(contract.request, {})).toEqual({});
      expect(() =>
        decode(contract.request, {
          feedUrl: 'http://127.0.0.1:1/local-feed',
          artifactPath: '/tmp/Tileborne.zip',
        }),
      ).toThrow();
    }
  });

  it('accepts bounded main-owned update diagnostics including signature failures', () => {
    expect(
      decode(DesktopUpdateState, {
        state: 'error',
        currentVersion: '1.0.0',
        diagnostic: {
          code: 'signature-failed',
          message: 'Downloaded update signature validation failed.',
        },
      }),
    ).toBeDefined();
  });

  it('rejects retained installer, rollback, and LKG receipt fields', () => {
    const validReceipt = {
      sourceVersion: '1.0.0',
      targetVersion: '1.0.1',
      zipSha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      bundleId: 'dev.tileborne.app',
      platform: 'darwin',
      architecture: 'arm64',
      teamIdentifier: 'ABCDE12345',
      checkedAt: '2026-07-26T11:30:00.000Z',
    };

    expect(decode(DesktopUpdateReceipt, validReceipt)).toBeDefined();
    expect(() =>
      decode(DesktopUpdateReceipt, {
        ...validReceipt,
        retainedInstallerPath: '/tmp/lkg.zip',
        rollbackVersion: '1.0.0',
        lkgReleaseId: 'latest-known-good',
      }),
    ).toThrow();
  });
});
