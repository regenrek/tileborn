/* eslint-disable @typescript-eslint/no-require-imports -- consumed by the CommonJS Forge config */
const fs = require('node:fs');

const RELEASE_FLAG = 'TILEBORNE_DESKTOP_RELEASE';
const REQUIRED_ENVIRONMENT = Object.freeze([
  'TILEBORNE_APPLE_SIGNING_IDENTITY',
  'TILEBORNE_APPLE_TEAM_ID',
  'TILEBORNE_APPLE_API_KEY_PATH',
  'TILEBORNE_APPLE_API_KEY_ID',
  'TILEBORNE_APPLE_API_ISSUER',
]);

const requireValue = (env, name) => {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`desktop-release.credentials-missing: ${name}`);
  }
  return value;
};

const createDesktopReleaseProvenance = ({ sourceCommit, version, teamIdentifier }) => {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error('desktop-release.invalid-source-commit: git rev-parse HEAD');
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('desktop-release.invalid-version: package version required');
  }
  if (!/^[A-Z0-9]{10}$/.test(teamIdentifier)) {
    throw new Error('desktop-release.invalid-team-id: expected 10 uppercase letters/digits');
  }
  return Object.freeze({
    schemaVersion: 1,
    policyId: 'tileborne-desktop-1.0',
    sourceCommit,
    version,
    teamIdentifier,
    buildCommand: 'pnpm --filter @tileborne/desktop package',
  });
};

const createDesktopReleaseForgeSettings = ({
  env = process.env,
  platform = process.platform,
  architecture = process.arch,
  existsSync = fs.existsSync,
} = {}) => {
  if (env[RELEASE_FLAG] !== '1') {
    return Object.freeze({ enabled: false });
  }
  if (platform !== 'darwin' || architecture !== 'arm64') {
    throw new Error(
      `desktop-release.unsupported-host: expected darwin/arm64, observed ${platform}/${architecture}`,
    );
  }

  const values = Object.fromEntries(
    REQUIRED_ENVIRONMENT.map((name) => [name, requireValue(env, name)]),
  );
  const identity = values.TILEBORNE_APPLE_SIGNING_IDENTITY;
  const teamIdentifier = values.TILEBORNE_APPLE_TEAM_ID;
  const apiKeyPath = values.TILEBORNE_APPLE_API_KEY_PATH;
  const apiKeyId = values.TILEBORNE_APPLE_API_KEY_ID;
  const apiIssuer = values.TILEBORNE_APPLE_API_ISSUER;

  if (!identity.startsWith('Developer ID Application:')) {
    throw new Error('desktop-release.invalid-identity: Developer ID Application identity required');
  }
  if (!/^[A-Z0-9]{10}$/.test(teamIdentifier)) {
    throw new Error('desktop-release.invalid-team-id: expected 10 uppercase letters/digits');
  }
  if (!/^[A-Z0-9]{10}$/.test(apiKeyId)) {
    throw new Error('desktop-release.invalid-api-key-id: expected 10 uppercase letters/digits');
  }
  if (!/^[a-f0-9-]{36}$/i.test(apiIssuer)) {
    throw new Error('desktop-release.invalid-api-issuer: expected UUID');
  }
  if (!existsSync(apiKeyPath)) {
    throw new Error('desktop-release.api-key-file-missing: configured path does not exist');
  }

  const notarizeCredentials = Object.freeze({
    appleApiKey: apiKeyPath,
    appleApiKeyId: apiKeyId,
    appleApiIssuer: apiIssuer,
  });
  return Object.freeze({
    enabled: true,
    teamIdentifier,
    packagerConfig: Object.freeze({
      osxSign: Object.freeze({
        identity,
        hardenedRuntime: true,
        strictVerify: true,
        continueOnError: false,
      }),
      osxNotarize: notarizeCredentials,
    }),
    dmgConfig: Object.freeze({
      additionalDMGOptions: Object.freeze({
        'code-sign': Object.freeze({
          'signing-identity': identity,
          identifier: 'dev.tileborne.app.installer',
        }),
      }),
    }),
    notarizeCredentials,
  });
};

const validateDesktopReleaseMakeResults = ({
  makeResults,
  provenanceInjected,
  existsSync = fs.existsSync,
}) => {
  if (provenanceInjected !== true) {
    throw new Error(
      'desktop-release.provenance-not-injected: signed app provenance must be embedded before make',
    );
  }
  if (!Array.isArray(makeResults) || makeResults.length !== 1) {
    throw new Error('desktop-release.unexpected-output-count: expected exactly one make result');
  }
  const [result] = makeResults;
  if (result === null || typeof result !== 'object') {
    throw new Error('desktop-release.invalid-output: make result must be an object');
  }
  if (result.platform !== 'darwin' || result.arch !== 'arm64') {
    throw new Error(
      `desktop-release.unexpected-output: ${String(result.platform)}/${String(result.arch)}`,
    );
  }
  if (!Array.isArray(result.artifacts) || result.artifacts.length !== 1) {
    throw new Error('desktop-release.unexpected-artifact-count: expected exactly one artifact');
  }
  const [artifact] = result.artifacts;
  if (typeof artifact !== 'string' || !artifact.toLowerCase().endsWith('.dmg')) {
    throw new Error(`desktop-release.unexpected-artifact: ${String(artifact)}`);
  }
  if (!existsSync(artifact)) {
    throw new Error(`desktop-release.dmg-missing: ${artifact}`);
  }
  return artifact;
};

module.exports = {
  RELEASE_FLAG,
  REQUIRED_ENVIRONMENT,
  createDesktopReleaseProvenance,
  createDesktopReleaseForgeSettings,
  validateDesktopReleaseMakeResults,
};
