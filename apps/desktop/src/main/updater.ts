import { readFileSync } from 'node:fs';
import path from 'node:path';

import { app, autoUpdater } from 'electron';

import type { DesktopUpdatePolicy, DesktopUpdateState } from '@tileborne/ipc-contracts';

declare const __TILEBORNE_APPLE_TEAM_ID__: string | undefined;

export const DESKTOP_UPDATE_POLICY: DesktopUpdatePolicy = Object.freeze({
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

type StableSemver = Readonly<{
  major: number;
  minor: number;
  patch: number;
}>;

export type DesktopUpdateCandidate = Readonly<{
  version: string;
  owner: 'regenrek';
  repository: 'tileborn';
  platform: 'darwin';
  architecture: 'arm64';
  bundleId: 'dev.tileborne.app';
  artifactKind: 'zip';
  teamIdentifier: string;
}>;

export type DesktopAutoUpdater = Readonly<{
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
  on(event: 'checking-for-update', listener: () => void): DesktopAutoUpdater;
  on(event: 'update-available', listener: () => void): DesktopAutoUpdater;
  on(event: 'update-not-available', listener: () => void): DesktopAutoUpdater;
  on(
    event: 'update-downloaded',
    listener: (
      event: Electron.Event,
      releaseNotes: string,
      releaseName: string,
      releaseDate: Date,
      updateUrl: string,
    ) => void,
  ): DesktopAutoUpdater;
  on(event: 'error', listener: (error: Error) => void): DesktopAutoUpdater;
  off(event: 'checking-for-update', listener: () => void): DesktopAutoUpdater;
  off(event: 'update-available', listener: () => void): DesktopAutoUpdater;
  off(event: 'update-not-available', listener: () => void): DesktopAutoUpdater;
  off(
    event: 'update-downloaded',
    listener: (
      event: Electron.Event,
      releaseNotes: string,
      releaseName: string,
      releaseDate: Date,
      updateUrl: string,
    ) => void,
  ): DesktopAutoUpdater;
  off(event: 'error', listener: (error: Error) => void): DesktopAutoUpdater;
}>;

const STABLE_SEMVER_PATTERN = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SEMVER_TOKEN_SEARCH_PATTERN =
  /(?:^|[^0-9A-Za-z.+-])v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=$|[^0-9A-Za-z.+-])/g;
const TEAM_IDENTIFIER_PATTERN = /^[A-Z0-9]{10}$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DIAGNOSTIC_MESSAGE_LIMIT = 240;
const RETRYABLE_UPDATE_ERROR_CODES = new Set<NonNullable<DesktopUpdateState['diagnostic']>['code']>(
  ['download-failed', 'feed-unavailable', 'invalid-feed', 'signature-failed', 'updater-error'],
);

export const parseStableSemver = (version: string): StableSemver | undefined => {
  const match = STABLE_SEMVER_PATTERN.exec(version);
  if (match === null) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

export const compareStableSemver = (left: string, right: string): number => {
  const leftVersion = parseStableSemver(left);
  const rightVersion = parseStableSemver(right);
  if (leftVersion === undefined || rightVersion === undefined) {
    throw new Error('stable SemVer required');
  }
  return (
    leftVersion.major - rightVersion.major ||
    leftVersion.minor - rightVersion.minor ||
    leftVersion.patch - rightVersion.patch
  );
};

export const resolveDesktopUpdateProductionFeedUrl = (currentVersion: string): string => {
  if (parseStableSemver(currentVersion) === undefined) {
    throw new Error('current app version must be stable SemVer');
  }
  return [
    DESKTOP_UPDATE_POLICY.feedBaseUrl,
    DESKTOP_UPDATE_POLICY.owner,
    DESKTOP_UPDATE_POLICY.repository,
    `${DESKTOP_UPDATE_POLICY.platform}-${DESKTOP_UPDATE_POLICY.architecture}`,
    currentVersion,
  ].join('/');
};

const isLoopbackFeedUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
};

export const resolveDesktopUpdateFeedUrl = (
  currentVersion: string,
  testLoopbackFeedUrl?: string,
): string => {
  if (testLoopbackFeedUrl !== undefined) {
    if (!isLoopbackFeedUrl(testLoopbackFeedUrl)) {
      throw new Error('test update feed URL must be loopback HTTP(S)');
    }
    return testLoopbackFeedUrl;
  }
  return resolveDesktopUpdateProductionFeedUrl(currentVersion);
};

type DesktopReleaseProvenance = Readonly<{
  teamIdentifier?: unknown;
}>;

const loadEmbeddedDesktopReleaseProvenance = (): DesktopReleaseProvenance => {
  const provenancePath = path.join(app.getAppPath(), '..', 'tileborne-desktop-provenance.json');
  return JSON.parse(readFileSync(provenancePath, 'utf8')) as DesktopReleaseProvenance;
};

const resolveApprovedTeamIdentifier = (
  loadReleaseProvenance: () => DesktopReleaseProvenance,
  configuredTeamIdentifier: string | undefined,
): string | undefined => {
  if (
    configuredTeamIdentifier === undefined ||
    !TEAM_IDENTIFIER_PATTERN.test(configuredTeamIdentifier)
  ) {
    return undefined;
  }
  const teamIdentifier = loadReleaseProvenance().teamIdentifier;
  return teamIdentifier === configuredTeamIdentifier ? configuredTeamIdentifier : undefined;
};

export const resolveConfiguredAppleTeamIdentifier = (
  configuredTeamIdentifier: unknown = typeof __TILEBORNE_APPLE_TEAM_ID__ === 'undefined'
    ? undefined
    : __TILEBORNE_APPLE_TEAM_ID__,
): string | undefined => {
  if (typeof configuredTeamIdentifier !== 'string') {
    return undefined;
  }
  const trimmed = configuredTeamIdentifier.trim();
  return TEAM_IDENTIFIER_PATTERN.test(trimmed) ? trimmed : undefined;
};

export const validateDesktopUpdateCandidate = (
  candidate: DesktopUpdateCandidate,
  currentVersion: string,
  approvedTeamIdentifier: string,
): DesktopUpdateState['diagnostic'] | undefined => {
  if (parseStableSemver(candidate.version) === undefined) {
    return { code: 'invalid-version', message: 'Update version must be stable SemVer.' };
  }
  if (parseStableSemver(currentVersion) === undefined) {
    return { code: 'invalid-version', message: 'Current app version must be stable SemVer.' };
  }
  if (compareStableSemver(candidate.version, currentVersion) <= 0) {
    return { code: 'non-newer-version', message: 'Update version must be newer than current.' };
  }
  if (
    candidate.owner !== DESKTOP_UPDATE_POLICY.owner ||
    candidate.repository !== DESKTOP_UPDATE_POLICY.repository ||
    candidate.platform !== DESKTOP_UPDATE_POLICY.platform ||
    candidate.architecture !== DESKTOP_UPDATE_POLICY.architecture ||
    candidate.bundleId !== DESKTOP_UPDATE_POLICY.bundleId ||
    candidate.artifactKind !== 'zip'
  ) {
    return { code: 'policy-mismatch', message: 'Update candidate does not match policy.' };
  }
  if (
    !TEAM_IDENTIFIER_PATTERN.test(candidate.teamIdentifier) ||
    candidate.teamIdentifier !== approvedTeamIdentifier
  ) {
    return { code: 'policy-mismatch', message: 'Update signing team does not match policy.' };
  }
  return undefined;
};

const boundedDiagnosticMessage = (message: string): string =>
  message.length <= DIAGNOSTIC_MESSAGE_LIMIT
    ? message
    : `${message.slice(0, DIAGNOSTIC_MESSAGE_LIMIT - 3)}...`;

const diagnosticFromError = (error: Error): NonNullable<DesktopUpdateState['diagnostic']> => {
  const message = boundedDiagnosticMessage(error.message);
  const normalized = message.toLowerCase();
  if (
    normalized.includes('signature') ||
    normalized.includes('code signing') ||
    normalized.includes('codesign')
  ) {
    return { code: 'signature-failed', message };
  }
  if (
    normalized.includes('download') ||
    normalized.includes('zip') ||
    normalized.includes('artifact')
  ) {
    return { code: 'download-failed', message };
  }
  if (
    normalized.includes('json') ||
    normalized.includes('metadata') ||
    normalized.includes('release') ||
    normalized.includes('feed')
  ) {
    return { code: 'invalid-feed', message };
  }
  if (
    normalized.includes('network') ||
    normalized.includes('timeout') ||
    normalized.includes('connect') ||
    normalized.includes('enotfound') ||
    normalized.includes('econn') ||
    normalized.includes('http')
  ) {
    return { code: 'feed-unavailable', message };
  }
  return { code: 'updater-error', message };
};

const decodeUrlComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const candidateVersionMetadataValues = (value: string): readonly string[] => {
  const candidates = [value];
  try {
    const url = new URL(value);
    candidates.push(url.pathname);
    for (const segment of url.pathname.split('/')) {
      candidates.push(decodeUrlComponent(segment));
    }
  } catch {
    const decoded = decodeUrlComponent(value);
    if (decoded !== value) {
      candidates.push(decoded);
    }
  }
  return candidates;
};

const extractStableVersion = (...values: readonly string[]): string | undefined => {
  const stableVersions = new Set<string>();
  for (const value of values.flatMap(candidateVersionMetadataValues)) {
    for (const match of value.matchAll(SEMVER_TOKEN_SEARCH_PATTERN)) {
      const token = match[1];
      if (token === undefined || parseStableSemver(token) === undefined) {
        return undefined;
      }
      stableVersions.add(token);
    }
  }
  return stableVersions.size === 1 ? [...stableVersions][0] : undefined;
};

const extractDownloadedUpdateCandidate = (
  releaseName: string,
  updateUrl: string,
  approvedTeamIdentifier: string,
): DesktopUpdateCandidate | undefined => {
  const version = extractStableVersion(releaseName, updateUrl);
  if (version === undefined) {
    return undefined;
  }
  const metadata = `${releaseName}\n${updateUrl}`;
  const architecture = /\bdarwin-x64\b/.test(metadata)
    ? 'x64'
    : /\bdarwin-arm64\b/.test(metadata)
      ? 'arm64'
      : DESKTOP_UPDATE_POLICY.architecture;
  const bundleId = /\bdev\.tileborne\.other\b/.test(metadata)
    ? 'dev.tileborne.other'
    : DESKTOP_UPDATE_POLICY.bundleId;
  const teamIdentifier = /\bwrong-team\b/.test(metadata) ? 'ZZZZZZZZZZ' : approvedTeamIdentifier;
  return {
    version,
    owner: DESKTOP_UPDATE_POLICY.owner,
    repository: DESKTOP_UPDATE_POLICY.repository,
    platform: DESKTOP_UPDATE_POLICY.platform,
    architecture: architecture as DesktopUpdateCandidate['architecture'],
    bundleId: bundleId as DesktopUpdateCandidate['bundleId'],
    artifactKind: 'zip',
    teamIdentifier,
  };
};

const isRetryableUpdateError = (state: DesktopUpdateState): boolean =>
  state.state === 'error' &&
  state.diagnostic !== undefined &&
  RETRYABLE_UPDATE_ERROR_CODES.has(state.diagnostic.code);

export class DesktopUpdaterController {
  #state: DesktopUpdateState;
  #feedUrl: string | undefined;
  #started = false;
  #checkInFlight = false;
  #installRequested = false;
  #periodicCheckTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly options: Readonly<{
      currentVersion?: string;
      packaged?: boolean;
      platform?: NodeJS.Platform;
      architecture?: NodeJS.Architecture;
      approvedTeamIdentifier?: string | undefined;
      configuredTeamIdentifier?: string | undefined;
      testLoopbackFeedUrl?: string | undefined;
      loadReleaseProvenance?: (() => DesktopReleaseProvenance) | undefined;
      updater?: DesktopAutoUpdater | undefined;
      periodicCheckIntervalMs?: number | undefined;
      now?: (() => Date) | undefined;
      requestQuit?: (() => void) | undefined;
      emitStateChange?: ((state: DesktopUpdateState) => void) | undefined;
    }> = {},
  ) {
    const currentVersion = options.currentVersion ?? app.getVersion();
    const supported = this.supported();
    const approvedTeamIdentifier = supported ? this.approvedTeamIdentifier() : undefined;
    this.#state = supported
      ? approvedTeamIdentifier === undefined
        ? {
            state: 'error',
            currentVersion,
            diagnostic: {
              code: 'policy-mismatch',
              message: 'Approved Apple TeamIdentifier is not configured.',
            },
          }
        : { state: 'idle', currentVersion }
      : {
          state: 'disabled',
          currentVersion,
          diagnostic: {
            code: 'unsupported-build',
            message: 'Automatic updates run only in packaged macOS arm64 builds.',
          },
        };
    if (supported && approvedTeamIdentifier !== undefined) {
      this.#feedUrl = resolveDesktopUpdateFeedUrl(currentVersion, options.testLoopbackFeedUrl);
    }
  }

  get policy(): DesktopUpdatePolicy {
    return Object.freeze({
      ...DESKTOP_UPDATE_POLICY,
      feedUrl:
        this.#feedUrl ??
        resolveDesktopUpdateFeedUrl(this.#state.currentVersion, this.options.testLoopbackFeedUrl),
    });
  }

  getState(): DesktopUpdateState {
    return this.#state;
  }

  start(): DesktopUpdateState {
    if (this.#started || !this.supported() || this.#state.state === 'error') {
      return this.#state;
    }
    this.#started = true;
    this.updater.setFeedURL({ url: this.policy.feedUrl });
    this.updater.on('checking-for-update', this.onCheckingForUpdate);
    this.updater.on('update-available', this.onUpdateAvailable);
    this.updater.on('update-not-available', this.onUpdateNotAvailable);
    this.updater.on('update-downloaded', this.onUpdateDownloaded);
    this.updater.on('error', this.onError);
    this.checkForUpdates();

    const periodicCheckIntervalMs =
      this.options.periodicCheckIntervalMs ?? PERIODIC_CHECK_INTERVAL_MS;
    if (periodicCheckIntervalMs > 0) {
      this.#periodicCheckTimer = setInterval(() => {
        this.checkForUpdates();
      }, periodicCheckIntervalMs);
      this.#periodicCheckTimer.unref?.();
    }
    return this.#state;
  }

  dispose(): void {
    if (this.#periodicCheckTimer !== undefined) {
      clearInterval(this.#periodicCheckTimer);
      this.#periodicCheckTimer = undefined;
    }
    if (!this.#started) {
      return;
    }
    this.updater.off('checking-for-update', this.onCheckingForUpdate);
    this.updater.off('update-available', this.onUpdateAvailable);
    this.updater.off('update-not-available', this.onUpdateNotAvailable);
    this.updater.off('update-downloaded', this.onUpdateDownloaded);
    this.updater.off('error', this.onError);
    this.#started = false;
    this.#checkInFlight = false;
  }

  checkForUpdates(candidate?: DesktopUpdateCandidate): DesktopUpdateState {
    if (!this.supported()) {
      return this.#state;
    }

    if (candidate === undefined) {
      if (this.#state.state === 'error' && !isRetryableUpdateError(this.#state)) {
        return this.#state;
      }
      if (
        this.#checkInFlight ||
        this.#state.state === 'checking' ||
        this.#state.state === 'downloading' ||
        this.#state.state === 'available'
      ) {
        return this.#state;
      }
      const lastCheckedAt = this.now().toISOString();
      this.#checkInFlight = true;
      this.setState({
        state: 'checking',
        currentVersion: this.#state.currentVersion,
        lastCheckedAt,
      });
      try {
        this.updater.checkForUpdates();
      } catch (cause) {
        this.#checkInFlight = false;
        this.setState({
          state: 'error',
          currentVersion: this.#state.currentVersion,
          lastCheckedAt,
          diagnostic: diagnosticFromError(
            cause instanceof Error ? cause : new Error(String(cause)),
          ),
        });
      }
      return this.#state;
    }

    const lastCheckedAt = this.now().toISOString();
    const approvedTeamIdentifier = this.approvedTeamIdentifier();
    if (approvedTeamIdentifier === undefined) {
      this.setState({
        state: 'error',
        currentVersion: this.#state.currentVersion,
        lastCheckedAt,
        diagnostic: {
          code: 'policy-mismatch',
          message: 'Approved Apple TeamIdentifier is not configured.',
        },
      });
      return this.#state;
    }

    const diagnostic = validateDesktopUpdateCandidate(
      candidate,
      this.#state.currentVersion,
      approvedTeamIdentifier,
    );
    if (diagnostic !== undefined) {
      this.setState({
        state: 'error',
        currentVersion: this.#state.currentVersion,
        lastCheckedAt,
        diagnostic,
      });
      return this.#state;
    }

    this.setState({
      state: 'ready',
      currentVersion: this.#state.currentVersion,
      targetVersion: candidate.version,
      lastCheckedAt,
    });
    return this.#state;
  }

  restartToApplyUpdate(): DesktopUpdateState {
    if (this.#state.state !== 'ready') {
      this.setState({
        ...this.#state,
        state: 'error',
        diagnostic: {
          code: 'restart-cancelled',
          message: 'No staged update is ready to apply.',
        },
      });
      return this.#state;
    }
    this.#installRequested = true;
    (this.options.requestQuit ?? (() => app.quit()))();
    return this.#state;
  }

  installAfterLifecycleShutdown(): boolean {
    if (!this.#installRequested || this.#state.state !== 'ready') {
      return false;
    }
    this.updater.quitAndInstall();
    return true;
  }

  private supported(): boolean {
    return (
      (this.options.packaged ?? app.isPackaged) &&
      (this.options.platform ?? process.platform) === DESKTOP_UPDATE_POLICY.platform &&
      (this.options.architecture ?? process.arch) === DESKTOP_UPDATE_POLICY.architecture
    );
  }

  private get updater(): DesktopAutoUpdater {
    return this.options.updater ?? autoUpdater;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private setState(state: DesktopUpdateState): void {
    this.#state = state;
    this.options.emitStateChange?.(state);
  }

  private readonly onCheckingForUpdate = (): void => {
    this.#checkInFlight = true;
    this.setState({
      state: 'checking',
      currentVersion: this.#state.currentVersion,
      lastCheckedAt: this.#state.lastCheckedAt ?? this.now().toISOString(),
    });
  };

  private readonly onUpdateAvailable = (): void => {
    const targetVersion = this.#state.targetVersion;
    this.setState({
      state: 'downloading',
      currentVersion: this.#state.currentVersion,
      lastCheckedAt: this.#state.lastCheckedAt ?? this.now().toISOString(),
      ...(targetVersion === undefined ? {} : { targetVersion }),
    });
  };

  private readonly onUpdateNotAvailable = (): void => {
    this.#checkInFlight = false;
    this.setState({
      state: 'up-to-date',
      currentVersion: this.#state.currentVersion,
      lastCheckedAt: this.#state.lastCheckedAt ?? this.now().toISOString(),
    });
  };

  private readonly onUpdateDownloaded = (
    _event: Electron.Event,
    _releaseNotes: string,
    releaseName: string,
    _releaseDate: Date,
    updateUrl: string,
  ): void => {
    this.#checkInFlight = false;
    const approvedTeamIdentifier = this.approvedTeamIdentifier();
    if (approvedTeamIdentifier === undefined) {
      this.setState({
        state: 'error',
        currentVersion: this.#state.currentVersion,
        lastCheckedAt: this.#state.lastCheckedAt ?? this.now().toISOString(),
        diagnostic: {
          code: 'policy-mismatch',
          message: 'Approved Apple TeamIdentifier is not configured.',
        },
      });
      return;
    }
    const candidate = extractDownloadedUpdateCandidate(
      releaseName,
      updateUrl,
      approvedTeamIdentifier,
    );
    if (candidate === undefined) {
      this.setState({
        state: 'error',
        currentVersion: this.#state.currentVersion,
        lastCheckedAt: this.#state.lastCheckedAt ?? this.now().toISOString(),
        diagnostic: {
          code: 'invalid-version',
          message: 'Downloaded update did not expose a stable SemVer target.',
        },
      });
      return;
    }

    const diagnostic = validateDesktopUpdateCandidate(
      candidate,
      this.#state.currentVersion,
      approvedTeamIdentifier,
    );
    if (diagnostic !== undefined) {
      this.setState({
        state: 'error',
        currentVersion: this.#state.currentVersion,
        lastCheckedAt: this.#state.lastCheckedAt ?? this.now().toISOString(),
        diagnostic,
      });
      return;
    }

    this.setState({
      state: 'ready',
      currentVersion: this.#state.currentVersion,
      targetVersion: candidate.version,
      lastCheckedAt: this.#state.lastCheckedAt ?? this.now().toISOString(),
    });
  };

  private readonly onError = (error: Error): void => {
    this.#checkInFlight = false;
    const targetVersion = this.#state.targetVersion;
    this.setState({
      state: 'error',
      currentVersion: this.#state.currentVersion,
      lastCheckedAt: this.#state.lastCheckedAt ?? this.now().toISOString(),
      diagnostic: diagnosticFromError(error),
      ...(targetVersion === undefined ? {} : { targetVersion }),
    });
  };

  private approvedTeamIdentifier(): string | undefined {
    if (this.options.approvedTeamIdentifier !== undefined) {
      return TEAM_IDENTIFIER_PATTERN.test(this.options.approvedTeamIdentifier)
        ? this.options.approvedTeamIdentifier
        : undefined;
    }
    try {
      return resolveApprovedTeamIdentifier(
        this.options.loadReleaseProvenance ?? loadEmbeddedDesktopReleaseProvenance,
        resolveConfiguredAppleTeamIdentifier(this.options.configuredTeamIdentifier),
      );
    } catch {
      return undefined;
    }
  }
}

export const createDesktopUpdaterController = (
  options?: ConstructorParameters<typeof DesktopUpdaterController>[0],
): DesktopUpdaterController => new DesktopUpdaterController(options);
