import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  DESKTOP_UPDATE_POLICY,
  type DesktopAutoUpdater,
  compareStableSemver,
  createDesktopUpdaterController,
  resolveConfiguredAppleTeamIdentifier,
  resolveDesktopUpdateFeedUrl,
  resolveDesktopUpdateProductionFeedUrl,
  validateDesktopUpdateCandidate,
  type DesktopUpdateCandidate,
} from './updater.js';
import { createDesktopUpdateHandlers } from './ipc/desktop-update-handlers.js';

const TEAM = 'ABCDE12345';
const NOW = new Date('2026-07-26T10:00:00.000Z');

type Listener = (...args: readonly unknown[]) => void;

class FakeAutoUpdater {
  readonly feedUrls: string[] = [];
  checkCalls = 0;
  quitAndInstallCalls = 0;
  readonly listeners = new Map<string, Set<Listener>>();

  setFeedURL({ url }: { url: string }): void {
    this.feedUrls.push(url);
  }

  checkForUpdates(): void {
    this.checkCalls += 1;
    this.emit('checking-for-update');
  }

  quitAndInstall(): void {
    this.quitAndInstallCalls += 1;
  }

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: readonly unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

const updaterOptions = (fake: FakeAutoUpdater) => ({
  currentVersion: '1.0.0',
  packaged: true,
  platform: 'darwin' as const,
  architecture: 'arm64' as const,
  approvedTeamIdentifier: TEAM,
  updater: fake as unknown as DesktopAutoUpdater,
  periodicCheckIntervalMs: 0,
  now: () => NOW,
});

const candidate = (patch: Partial<DesktopUpdateCandidate> = {}): DesktopUpdateCandidate => ({
  version: '1.0.1',
  owner: 'regenrek',
  repository: 'tileborn',
  platform: 'darwin',
  architecture: 'arm64',
  bundleId: 'dev.tileborne.app',
  artifactKind: 'zip',
  teamIdentifier: TEAM,
  ...patch,
});

describe('desktop updater ownership contract', () => {
  it('uses the immutable production feed policy', () => {
    expect(DESKTOP_UPDATE_POLICY).toEqual({
      owner: 'regenrek',
      repository: 'tileborn',
      channel: 'github-release',
      feedBaseUrl: 'https://update.electronjs.org',
      feedUrl: 'https://update.electronjs.org/regenrek/tileborn/darwin-arm64/0.0.0',
      platform: 'darwin',
      architecture: 'arm64',
      bundleId: 'dev.tileborne.app',
      expectedTeamIdentifierEnvironment: 'TILEBORNE_APPLE_TEAM_ID',
    });
    expect(Object.isFrozen(DESKTOP_UPDATE_POLICY)).toBe(true);
  });

  it('resolves the production feed from the validated current version', () => {
    expect(resolveDesktopUpdateProductionFeedUrl('1.2.3')).toBe(
      'https://update.electronjs.org/regenrek/tileborn/darwin-arm64/1.2.3',
    );
    expect(() => resolveDesktopUpdateProductionFeedUrl('1.2.3-beta.1')).toThrow(/stable SemVer/);

    const updater = createDesktopUpdaterController({
      currentVersion: '1.2.3',
      packaged: true,
      platform: 'darwin',
      architecture: 'arm64',
      approvedTeamIdentifier: TEAM,
    });
    expect(updater.policy.feedUrl).toBe(
      'https://update.electronjs.org/regenrek/tileborn/darwin-arm64/1.2.3',
    );
  });

  it('permits only explicit test loopback feed injection', () => {
    expect(resolveDesktopUpdateFeedUrl('1.0.0', 'http://127.0.0.1:4100/update')).toBe(
      'http://127.0.0.1:4100/update',
    );
    expect(() => resolveDesktopUpdateFeedUrl('1.0.0', 'https://example.com/update')).toThrow(
      /loopback/,
    );
  });

  it('allows only strictly newer stable SemVer versions', () => {
    expect(compareStableSemver('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareStableSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareStableSemver('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(() => compareStableSemver('1.0.1-beta.1', '1.0.0')).toThrow();
  });

  it('rejects same-version, downgrade, rollback, and policy-mismatched candidates', () => {
    expect(validateDesktopUpdateCandidate(candidate({ version: '1.0.0' }), '1.0.0', TEAM)).toEqual(
      expect.objectContaining({ code: 'non-newer-version' }),
    );
    expect(validateDesktopUpdateCandidate(candidate({ version: '0.9.9' }), '1.0.0', TEAM)).toEqual(
      expect.objectContaining({ code: 'non-newer-version' }),
    );
    expect(
      validateDesktopUpdateCandidate(candidate({ version: '1.0.1-lkg.1' }), '1.0.0', TEAM),
    ).toEqual(expect.objectContaining({ code: 'invalid-version' }));
    expect(
      validateDesktopUpdateCandidate(candidate({ artifactKind: 'dmg' as 'zip' }), '1.0.0', TEAM),
    ).toEqual(expect.objectContaining({ code: 'policy-mismatch' }));
    expect(
      validateDesktopUpdateCandidate(candidate({ teamIdentifier: 'ZZZZZ99999' }), '1.0.0', TEAM),
    ).toEqual(expect.objectContaining({ code: 'policy-mismatch' }));
  });

  it('keeps unsupported builds disabled and free of renderer feed authority', () => {
    const updater = createDesktopUpdaterController({
      currentVersion: '1.0.0',
      packaged: false,
      platform: 'darwin',
      architecture: 'arm64',
      approvedTeamIdentifier: TEAM,
    });

    expect(updater.getState()).toEqual(
      expect.objectContaining({
        state: 'disabled',
        diagnostic: expect.objectContaining({ code: 'unsupported-build' }),
      }),
    );
    expect(updater.checkForUpdates(candidate())).toEqual(
      expect.objectContaining({
        state: 'disabled',
        diagnostic: expect.objectContaining({ code: 'unsupported-build' }),
      }),
    );
  });

  it('transitions only through main-owned candidate validation', () => {
    const updater = createDesktopUpdaterController({
      currentVersion: '1.0.0',
      packaged: true,
      platform: 'darwin',
      architecture: 'arm64',
      approvedTeamIdentifier: TEAM,
    });

    expect(updater.getState().state).toBe('idle');
    expect(updater.checkForUpdates(candidate())).toEqual(
      expect.objectContaining({ state: 'ready', targetVersion: '1.0.1' }),
    );
  });

  it('fails closed during production controller construction without approved signing continuity', () => {
    const missing = createDesktopUpdaterController({
      currentVersion: '1.0.0',
      packaged: true,
      platform: 'darwin',
      architecture: 'arm64',
      loadReleaseProvenance: () => ({ teamIdentifier: null }),
    });
    expect(missing.getState()).toEqual(
      expect.objectContaining({
        state: 'error',
        diagnostic: expect.objectContaining({ code: 'policy-mismatch' }),
      }),
    );

    const malformed = createDesktopUpdaterController({
      currentVersion: '1.0.0',
      packaged: true,
      platform: 'darwin',
      architecture: 'arm64',
      loadReleaseProvenance: () => ({ teamIdentifier: 'bad-team' }),
    });
    expect(malformed.getState()).toEqual(
      expect.objectContaining({
        state: 'error',
        diagnostic: expect.objectContaining({ code: 'policy-mismatch' }),
      }),
    );
  });

  it('fails closed during production construction without a configured signing identity', () => {
    const updater = createDesktopUpdaterController({
      currentVersion: '1.0.0',
      packaged: true,
      platform: 'darwin',
      architecture: 'arm64',
      loadReleaseProvenance: () => ({ teamIdentifier: TEAM }),
    });

    expect(updater.getState()).toEqual(
      expect.objectContaining({
        state: 'error',
        diagnostic: expect.objectContaining({ code: 'policy-mismatch' }),
      }),
    );
  });

  it('fails closed during production construction when configured and embedded identities differ', () => {
    const updater = createDesktopUpdaterController({
      currentVersion: '1.0.0',
      packaged: true,
      platform: 'darwin',
      architecture: 'arm64',
      configuredTeamIdentifier: 'ZZZZZ99999',
      loadReleaseProvenance: () => ({ teamIdentifier: TEAM }),
    });

    expect(updater.getState()).toEqual(
      expect.objectContaining({
        state: 'error',
        diagnostic: expect.objectContaining({ code: 'policy-mismatch' }),
      }),
    );
  });

  it('fails closed during production construction with a malformed configured identity', () => {
    expect(resolveConfiguredAppleTeamIdentifier('bad-team')).toBeUndefined();

    const updater = createDesktopUpdaterController({
      currentVersion: '1.0.0',
      packaged: true,
      platform: 'darwin',
      architecture: 'arm64',
      configuredTeamIdentifier: 'bad-team',
      loadReleaseProvenance: () => ({ teamIdentifier: TEAM }),
    });

    expect(updater.getState()).toEqual(
      expect.objectContaining({
        state: 'error',
        diagnostic: expect.objectContaining({ code: 'policy-mismatch' }),
      }),
    );
  });

  it('allows production construction when configured and embedded identities match', () => {
    const updater = createDesktopUpdaterController({
      currentVersion: '1.0.0',
      packaged: true,
      platform: 'darwin',
      architecture: 'arm64',
      configuredTeamIdentifier: TEAM,
      loadReleaseProvenance: () => ({ teamIdentifier: TEAM }),
    });

    expect(updater.getState()).toEqual(expect.objectContaining({ state: 'idle' }));
    expect(updater.checkForUpdates(candidate())).toEqual(
      expect.objectContaining({ state: 'ready', targetVersion: '1.0.1' }),
    );
  });

  it('uses embedded release provenance as the production signing authority', () => {
    const updater = createDesktopUpdaterController({
      currentVersion: '1.0.0',
      packaged: true,
      platform: 'darwin',
      architecture: 'arm64',
      configuredTeamIdentifier: TEAM,
      loadReleaseProvenance: () => ({ teamIdentifier: TEAM }),
    });

    expect(updater.getState()).toEqual(expect.objectContaining({ state: 'idle' }));
    expect(updater.checkForUpdates(candidate())).toEqual(
      expect.objectContaining({ state: 'ready', targetVersion: '1.0.1' }),
    );
  });

  it('starts one feed-backed lifecycle for startup and manual checks', () => {
    const fake = new FakeAutoUpdater();
    const states: string[] = [];
    const updater = createDesktopUpdaterController({
      ...updaterOptions(fake),
      emitStateChange: (state) => {
        states.push(state.state);
      },
    });

    expect(updater.start()).toEqual(
      expect.objectContaining({ state: 'checking', lastCheckedAt: NOW.toISOString() }),
    );
    expect(fake.feedUrls).toEqual([
      'https://update.electronjs.org/regenrek/tileborn/darwin-arm64/1.0.0',
    ]);
    expect(fake.checkCalls).toBe(1);

    expect(updater.checkForUpdates()).toEqual(expect.objectContaining({ state: 'checking' }));
    expect(fake.checkCalls).toBe(1);

    fake.emit('update-not-available');
    expect(updater.getState()).toEqual(
      expect.objectContaining({ state: 'up-to-date', lastCheckedAt: NOW.toISOString() }),
    );
    expect(states).toEqual(['checking', 'checking', 'up-to-date']);

    expect(updater.checkForUpdates()).toEqual(expect.objectContaining({ state: 'checking' }));
    expect(fake.checkCalls).toBe(2);
  });

  it('maps downloaded updates into ready state only for newer stable versions', () => {
    const fake = new FakeAutoUpdater();
    const updater = createDesktopUpdaterController(updaterOptions(fake));

    updater.start();
    fake.emit('update-available');
    expect(updater.getState()).toEqual(expect.objectContaining({ state: 'downloading' }));

    fake.emit(
      'update-downloaded',
      {},
      '',
      'Tileborne 1.0.1',
      NOW,
      'https://github.com/regenrek/tileborn/releases/download/v1.0.1/tileborne-darwin-arm64.zip',
    );
    expect(updater.getState()).toEqual(
      expect.objectContaining({ state: 'ready', targetVersion: '1.0.1' }),
    );
  });

  it('rejects downloaded update metadata outside the approved artifact policy', () => {
    const cases = [
      [
        'Tileborne 1.0.1',
        'https://github.com/regenrek/tileborn/releases/download/v1.0.1/Tileborne-darwin-x64-1.0.1.zip',
      ],
      [
        'Tileborne dev.tileborne.other 1.0.1',
        'https://github.com/regenrek/tileborn/releases/download/v1.0.1/Tileborne-darwin-arm64-1.0.1.zip',
      ],
      [
        'Tileborne wrong-team 1.0.1',
        'https://github.com/regenrek/tileborn/releases/download/v1.0.1/Tileborne-darwin-arm64-1.0.1.zip',
      ],
    ] as const;

    for (const [releaseName, updateUrl] of cases) {
      const fake = new FakeAutoUpdater();
      const updater = createDesktopUpdaterController(updaterOptions(fake));

      updater.start();
      fake.emit('update-available');
      fake.emit('update-downloaded', {}, '', releaseName, NOW, updateUrl);

      expect(updater.getState()).toEqual(
        expect.objectContaining({
          state: 'error',
          diagnostic: expect.objectContaining({ code: 'policy-mismatch' }),
        }),
      );
    }
  });

  it('rejects prerelease and build metadata from downloaded update events', () => {
    const cases = [
      [
        'Tileborne v1.0.1-beta.1',
        'https://github.com/regenrek/tileborn/releases/download/v1.0.1-beta.1/tileborne-darwin-arm64.zip',
      ],
      [
        'Tileborne v1.0.1+build.1',
        'https://github.com/regenrek/tileborn/releases/download/v1.0.1+build.1/tileborne-darwin-arm64.zip',
      ],
    ] as const;

    for (const [releaseName, updateUrl] of cases) {
      const fake = new FakeAutoUpdater();
      const updater = createDesktopUpdaterController(updaterOptions(fake));

      updater.start();
      fake.emit('update-available');
      fake.emit('update-downloaded', {}, '', releaseName, NOW, updateUrl);

      expect(updater.getState()).toEqual(
        expect.objectContaining({
          state: 'error',
          diagnostic: expect.objectContaining({ code: 'invalid-version' }),
        }),
      );
    }
  });

  it('rejects downloaded updates when release name and URL version metadata disagree', () => {
    const cases = [
      [
        'Tileborne v1.0.1-beta.1',
        'https://github.com/regenrek/tileborn/releases/download/v1.0.1/tileborne-darwin-arm64.zip',
      ],
      [
        'Tileborne v1.0.1',
        'https://github.com/regenrek/tileborn/releases/download/v1.0.1+build.1/tileborne-darwin-arm64.zip',
      ],
      [
        'Tileborne v1.0.1',
        'https://github.com/regenrek/tileborn/releases/download/v1.0.2/tileborne-darwin-arm64.zip',
      ],
    ] as const;

    for (const [releaseName, updateUrl] of cases) {
      const fake = new FakeAutoUpdater();
      const updater = createDesktopUpdaterController(updaterOptions(fake));

      updater.start();
      fake.emit('update-available');
      fake.emit('update-downloaded', {}, '', releaseName, NOW, updateUrl);

      expect(updater.getState()).toEqual(
        expect.objectContaining({
          state: 'error',
          diagnostic: expect.objectContaining({ code: 'invalid-version' }),
        }),
      );
    }
  });

  it('rejects percent-encoded build metadata from downloaded update URLs', () => {
    const fake = new FakeAutoUpdater();
    const updater = createDesktopUpdaterController(updaterOptions(fake));

    updater.start();
    fake.emit('update-available');
    fake.emit(
      'update-downloaded',
      {},
      '',
      'Tileborne v1.0.1',
      NOW,
      'https://github.com/regenrek/tileborn/releases/download/v1.0.1%2Bbuild.1/tileborne-darwin-arm64.zip',
    );

    expect(updater.getState()).toEqual(
      expect.objectContaining({
        state: 'error',
        diagnostic: expect.objectContaining({ code: 'invalid-version' }),
      }),
    );
  });

  it('maps metadata, network, download, and signature failures to bounded diagnostics', () => {
    const cases = [
      ['metadata JSON failed', 'invalid-feed'],
      ['network timeout while checking', 'feed-unavailable'],
      ['download zip failed', 'download-failed'],
      ['signature validation failed', 'signature-failed'],
    ] as const;

    for (const [message, code] of cases) {
      const fake = new FakeAutoUpdater();
      const updater = createDesktopUpdaterController(updaterOptions(fake));
      updater.start();
      fake.emit('error', new Error(`${message} ${'x'.repeat(300)}`));

      expect(updater.getState()).toEqual(
        expect.objectContaining({
          state: 'error',
          diagnostic: expect.objectContaining({ code }),
        }),
      );
      expect(updater.getState().diagnostic?.message.length).toBeLessThanOrEqual(240);
    }
  });

  it('allows manual IPC retry after transient updater failures', () => {
    const fake = new FakeAutoUpdater();
    const updater = createDesktopUpdaterController(updaterOptions(fake));
    const handlers = createDesktopUpdateHandlers(updater);

    updater.start();
    expect(fake.checkCalls).toBe(1);

    fake.emit('error', new Error('network timeout while checking'));
    expect(updater.getState()).toEqual(
      expect.objectContaining({
        state: 'error',
        diagnostic: expect.objectContaining({ code: 'feed-unavailable' }),
      }),
    );

    expect(Effect.runSync(handlers['tileborne:desktop-updates:check']({}))).toEqual(
      expect.objectContaining({ state: 'checking' }),
    );
    expect(fake.checkCalls).toBe(2);
  });

  it('disposes timers and Electron updater listeners', () => {
    const fake = new FakeAutoUpdater();
    const updater = createDesktopUpdaterController(updaterOptions(fake));

    updater.start();
    updater.dispose();

    expect([...fake.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    fake.emit('update-not-available');
    expect(updater.getState()).toEqual(expect.objectContaining({ state: 'checking' }));
  });

  it('requests app shutdown first and calls quitAndInstall only after lifecycle shutdown', () => {
    const fake = new FakeAutoUpdater();
    let quitRequests = 0;
    const updater = createDesktopUpdaterController({
      ...updaterOptions(fake),
      requestQuit: () => {
        quitRequests += 1;
      },
    });

    expect(updater.restartToApplyUpdate()).toEqual(
      expect.objectContaining({
        state: 'error',
        diagnostic: expect.objectContaining({ code: 'restart-cancelled' }),
      }),
    );
    expect(fake.quitAndInstallCalls).toBe(0);

    updater.checkForUpdates(candidate());
    expect(updater.restartToApplyUpdate()).toEqual(expect.objectContaining({ state: 'ready' }));
    expect(quitRequests).toBe(1);
    expect(fake.quitAndInstallCalls).toBe(0);

    expect(updater.installAfterLifecycleShutdown()).toBe(true);
    expect(fake.quitAndInstallCalls).toBe(1);
  });

  it('rejects candidates signed by a different team than embedded release provenance', () => {
    const updater = createDesktopUpdaterController({
      currentVersion: '1.0.0',
      packaged: true,
      platform: 'darwin',
      architecture: 'arm64',
      configuredTeamIdentifier: TEAM,
      loadReleaseProvenance: () => ({ teamIdentifier: TEAM }),
    });

    expect(updater.checkForUpdates(candidate({ teamIdentifier: 'ZZZZZ99999' }))).toEqual(
      expect.objectContaining({
        state: 'error',
        diagnostic: expect.objectContaining({ code: 'policy-mismatch' }),
      }),
    );
  });

  it('keeps desktop update IPC commands on one main-process state machine', () => {
    const fake = new FakeAutoUpdater();
    const updater = createDesktopUpdaterController({
      ...updaterOptions(fake),
    });
    const handlers = createDesktopUpdateHandlers(updater);

    expect(Effect.runSync(handlers['tileborne:desktop-updates:getState']({}))).toEqual(
      expect.objectContaining({ state: 'idle' }),
    );
    expect(Effect.runSync(handlers['tileborne:desktop-updates:check']({}))).toEqual(
      expect.objectContaining({ state: 'checking' }),
    );
    expect(Effect.runSync(handlers['tileborne:desktop-updates:getState']({}))).toEqual(
      expect.objectContaining({ state: 'checking' }),
    );
    expect(Effect.runSync(handlers['tileborne:desktop-updates:restart']({}))).toEqual(
      expect.objectContaining({
        state: 'error',
        diagnostic: expect.objectContaining({ code: 'restart-cancelled' }),
      }),
    );
  });
});
