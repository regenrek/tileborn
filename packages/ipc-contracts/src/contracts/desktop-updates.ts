import { Schema } from 'effect';

import { defineContract } from '../contract.js';
import { createRegistry } from '../registry.js';
import { defineEvent } from '../events-core.js';
import { IpcContractErrors, IsoDateTimeString } from './common.js';

const NoDesktopUpdateCommandInput = Schema.Record(Schema.String, Schema.Never);

export const DesktopUpdateStateKind = Schema.Union([
  Schema.Literal('disabled'),
  Schema.Literal('idle'),
  Schema.Literal('checking'),
  Schema.Literal('available'),
  Schema.Literal('downloading'),
  Schema.Literal('ready'),
  Schema.Literal('up-to-date'),
  Schema.Literal('error'),
]);

export const DesktopUpdateDiagnosticCode = Schema.Union([
  Schema.Literal('unsupported-build'),
  Schema.Literal('feed-unavailable'),
  Schema.Literal('invalid-feed'),
  Schema.Literal('invalid-version'),
  Schema.Literal('non-newer-version'),
  Schema.Literal('policy-mismatch'),
  Schema.Literal('download-failed'),
  Schema.Literal('signature-failed'),
  Schema.Literal('restart-cancelled'),
  Schema.Literal('updater-error'),
]);

export const DesktopUpdateProgress = Schema.Struct({
  percent: Schema.Number.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100)),
  ),
  transferredBytes: Schema.optionalKey(
    Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  ),
  totalBytes: Schema.optionalKey(
    Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  ),
});

export const DesktopUpdateDiagnostic = Schema.Struct({
  code: DesktopUpdateDiagnosticCode,
  message: Schema.String,
});

export const DesktopUpdateState = Schema.Struct({
  state: DesktopUpdateStateKind,
  currentVersion: Schema.String,
  targetVersion: Schema.optionalKey(Schema.String),
  progress: Schema.optionalKey(DesktopUpdateProgress),
  lastCheckedAt: Schema.optionalKey(IsoDateTimeString),
  diagnostic: Schema.optionalKey(DesktopUpdateDiagnostic),
});

export type DesktopUpdateState = typeof DesktopUpdateState.Type;

export const DesktopUpdatePolicy = Schema.Struct({
  owner: Schema.Literal('regenrek'),
  repository: Schema.Literal('tileborn'),
  channel: Schema.Literal('github-release'),
  feedBaseUrl: Schema.Literal('https://update.electronjs.org'),
  feedUrl: Schema.String.check(
    Schema.isPattern(
      /^https:\/\/update\.electronjs\.org\/regenrek\/tileborn\/darwin-arm64\/(?:v)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/,
    ),
  ),
  platform: Schema.Literal('darwin'),
  architecture: Schema.Literal('arm64'),
  bundleId: Schema.Literal('dev.tileborne.app'),
  expectedTeamIdentifierEnvironment: Schema.Literal('TILEBORNE_APPLE_TEAM_ID'),
});

export type DesktopUpdatePolicy = typeof DesktopUpdatePolicy.Type;

export type DesktopUpdateReceipt = Readonly<{
  sourceVersion: string;
  targetVersion: string;
  zipSha256: string;
  sourceCommit: string;
  bundleId: 'dev.tileborne.app';
  platform: 'darwin';
  architecture: 'arm64';
  teamIdentifier: string;
  checkedAt: string;
  downloadedAt?: string;
  relaunchedAt?: string;
  relaunchVersion?: string;
  projectPersistenceEvidence?: string;
}>;

const DESKTOP_UPDATE_RECEIPT_KEYS = new Set([
  'sourceVersion',
  'targetVersion',
  'zipSha256',
  'sourceCommit',
  'bundleId',
  'platform',
  'architecture',
  'teamIdentifier',
  'checkedAt',
  'downloadedAt',
  'relaunchedAt',
  'relaunchVersion',
  'projectPersistenceEvidence',
]);

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIsoDateTimeString = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);

export const DesktopUpdateReceipt: Schema.Schema<DesktopUpdateReceipt> =
  Schema.declare<DesktopUpdateReceipt>(
    (value): value is DesktopUpdateReceipt => {
      if (!isObjectRecord(value)) {
        return false;
      }
      for (const key of Object.keys(value)) {
        if (!DESKTOP_UPDATE_RECEIPT_KEYS.has(key)) {
          return false;
        }
      }
      return (
        typeof value.sourceVersion === 'string' &&
        typeof value.targetVersion === 'string' &&
        typeof value.zipSha256 === 'string' &&
        /^sha256:[a-f0-9]{64}$/.test(value.zipSha256) &&
        typeof value.sourceCommit === 'string' &&
        /^[a-f0-9]{40}$/.test(value.sourceCommit) &&
        value.bundleId === 'dev.tileborne.app' &&
        value.platform === 'darwin' &&
        value.architecture === 'arm64' &&
        typeof value.teamIdentifier === 'string' &&
        /^[A-Z0-9]{10}$/.test(value.teamIdentifier) &&
        isIsoDateTimeString(value.checkedAt) &&
        (value.downloadedAt === undefined || isIsoDateTimeString(value.downloadedAt)) &&
        (value.relaunchedAt === undefined || isIsoDateTimeString(value.relaunchedAt)) &&
        (value.relaunchVersion === undefined || typeof value.relaunchVersion === 'string') &&
        (value.projectPersistenceEvidence === undefined ||
          typeof value.projectPersistenceEvidence === 'string')
      );
    },
    { title: 'DesktopUpdateReceipt' },
  );

export const DesktopUpdateReceiptShape = Schema.Struct({
  sourceVersion: Schema.String,
  targetVersion: Schema.String,
  zipSha256: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
  sourceCommit: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  bundleId: Schema.Literal('dev.tileborne.app'),
  platform: Schema.Literal('darwin'),
  architecture: Schema.Literal('arm64'),
  teamIdentifier: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{10}$/)),
  checkedAt: IsoDateTimeString,
  downloadedAt: Schema.optionalKey(IsoDateTimeString),
  relaunchedAt: Schema.optionalKey(IsoDateTimeString),
  relaunchVersion: Schema.optionalKey(Schema.String),
  projectPersistenceEvidence: Schema.optionalKey(Schema.String),
});

export const DesktopUpdatesGetStateContract = defineContract({
  channel: 'tileborne:desktop-updates:getState',
  request: NoDesktopUpdateCommandInput,
  response: DesktopUpdateState,
  errors: IpcContractErrors,
});

export const DesktopUpdatesCheckContract = defineContract({
  channel: 'tileborne:desktop-updates:check',
  request: NoDesktopUpdateCommandInput,
  response: DesktopUpdateState,
  errors: IpcContractErrors,
});

export const DesktopUpdatesRestartContract = defineContract({
  channel: 'tileborne:desktop-updates:restart',
  request: NoDesktopUpdateCommandInput,
  response: DesktopUpdateState,
  errors: IpcContractErrors,
});

export const DesktopUpdateStateChangedEvent = defineEvent({
  channel: 'tileborne:desktop-updates:stateChanged',
  payload: DesktopUpdateState,
});

export const DesktopUpdateContracts = [
  DesktopUpdatesGetStateContract,
  DesktopUpdatesCheckContract,
  DesktopUpdatesRestartContract,
] as const;

export const DesktopUpdateIpcRegistry = createRegistry(DesktopUpdateContracts);
