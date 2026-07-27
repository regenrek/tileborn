/* eslint-disable @typescript-eslint/no-require-imports -- consumed by the CommonJS Forge config */
const fs = require('node:fs');
const path = require('node:path');

const RELEASE_FLAG = 'TILEBORNE_DESKTOP_RELEASE';
const ORACLE_FIXTURE_FLAG = 'TILEBORNE_DESKTOP_UPDATE_ORACLE_FIXTURE';
const ORACLE_CAPABILITY_NONCE = 'TILEBORNE_DESKTOP_ORACLE_CAPABILITY_NONCE';
const RELEASE_ENTITLEMENTS_PATH = path.resolve(__dirname, '../assets/entitlements.mac.plist');
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

const createDesktopBuildProvenance = ({ sourceCommit, version, teamIdentifier = null }) => {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error('desktop-release.invalid-source-commit: git rev-parse HEAD');
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('desktop-release.invalid-version: package version required');
  }
  if (teamIdentifier !== null && !/^[A-Z0-9]{10}$/.test(teamIdentifier)) {
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

const createDesktopReleaseProvenance = ({ sourceCommit, version, teamIdentifier }) => {
  if (!/^[A-Z0-9]{10}$/.test(teamIdentifier)) {
    throw new Error('desktop-release.invalid-team-id: expected 10 uppercase letters/digits');
  }
  return createDesktopBuildProvenance({ sourceCommit, version, teamIdentifier });
};

const expectedDarwinArm64ZipName = (version) => `Tileborne-darwin-arm64-${version}.zip`;

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
  if (!existsSync(RELEASE_ENTITLEMENTS_PATH)) {
    throw new Error('desktop-release.entitlements-missing: assets/entitlements.mac.plist');
  }

  // Electron Forge renders string templates by mutating every config object it
  // receives. Keep the Forge-owned settings mutable; freezing these objects
  // makes configuration loading fail before packaging starts.
  const notarizeCredentials = {
    appleApiKey: apiKeyPath,
    appleApiKeyId: apiKeyId,
    appleApiIssuer: apiIssuer,
  };
  return Object.freeze({
    enabled: true,
    teamIdentifier,
    packagerConfig: {
      osxSign: {
        identity,
        entitlements: RELEASE_ENTITLEMENTS_PATH,
        entitlementsInherit: RELEASE_ENTITLEMENTS_PATH,
        hardenedRuntime: true,
        strictVerify: true,
        continueOnError: false,
      },
      osxNotarize: notarizeCredentials,
    },
    dmgConfig: {
      additionalDMGOptions: {
        'code-sign': {
          'signing-identity': identity,
          identifier: 'dev.tileborne.app.installer',
        },
      },
    },
    notarizeCredentials,
    entitlementsPath: RELEASE_ENTITLEMENTS_PATH,
  });
};

const createDesktopUpdateOracleForgeSettings = ({
  env = process.env,
  platform = process.platform,
  architecture = process.arch,
  existsSync = fs.existsSync,
} = {}) => {
  if (env[ORACLE_FIXTURE_FLAG] !== '1') {
    return Object.freeze({ enabled: false });
  }
  if (platform !== 'darwin' || architecture !== 'arm64') {
    throw new Error(
      `desktop-release.unsupported-host: expected darwin/arm64, observed ${platform}/${architecture}`,
    );
  }
  const identity = requireValue(env, 'TILEBORNE_APPLE_SIGNING_IDENTITY');
  const teamIdentifier = requireValue(env, 'TILEBORNE_APPLE_TEAM_ID');
  const version = requireValue(env, 'TILEBORNE_DESKTOP_ORACLE_VERSION');
  const capabilityNonce = requireValue(env, ORACLE_CAPABILITY_NONCE);
  if (!identity.startsWith('Developer ID Application:')) {
    throw new Error('desktop-release.invalid-identity: Developer ID Application identity required');
  }
  if (!/^[A-Z0-9]{10}$/.test(teamIdentifier)) {
    throw new Error('desktop-release.invalid-team-id: expected 10 uppercase letters/digits');
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('desktop-release.invalid-version: stable SemVer required');
  }
  if (!/^[a-f0-9]{64}$/.test(capabilityNonce)) {
    throw new Error(
      'desktop-release.invalid-oracle-capability-nonce: expected 64 lowercase hex characters',
    );
  }
  if (!existsSync(RELEASE_ENTITLEMENTS_PATH)) {
    throw new Error('desktop-release.entitlements-missing: assets/entitlements.mac.plist');
  }
  return Object.freeze({
    enabled: true,
    teamIdentifier,
    version,
    capabilityNonce,
    packagerConfig: {
      appVersion: version,
      buildVersion: version,
      osxSign: {
        identity,
        entitlements: RELEASE_ENTITLEMENTS_PATH,
        hardenedRuntime: true,
        strictVerify: true,
        continueOnError: false,
      },
    },
  });
};

const validateDesktopReleaseMakeResults = ({
  makeResults,
  provenanceInjected,
  version,
  existsSync = fs.existsSync,
}) => {
  if (provenanceInjected !== true) {
    throw new Error(
      'desktop-release.provenance-not-injected: signed app provenance must be embedded before make',
    );
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('desktop-release.invalid-version: package version required');
  }
  if (!Array.isArray(makeResults) || makeResults.length !== 2) {
    throw new Error('desktop-release.unexpected-output-count: expected DMG and ZIP make results');
  }
  const artifacts = [];
  for (const result of makeResults) {
    if (result === null || typeof result !== 'object') {
      throw new Error('desktop-release.invalid-output: make result must be an object');
    }
    if (result.platform !== 'darwin' || result.arch !== 'arm64') {
      throw new Error(
        `desktop-release.unexpected-output: ${String(result.platform)}/${String(result.arch)}`,
      );
    }
    if (!Array.isArray(result.artifacts) || result.artifacts.length !== 1) {
      throw new Error('desktop-release.unexpected-artifact-count: expected one artifact per maker');
    }
    artifacts.push(...result.artifacts);
  }
  if (artifacts.length !== 2) {
    throw new Error('desktop-release.unexpected-artifact-count: expected DMG plus update ZIP');
  }
  const dmgs = artifacts.filter(
    (artifact) => typeof artifact === 'string' && artifact.toLowerCase().endsWith('.dmg'),
  );
  const zips = artifacts.filter(
    (artifact) => typeof artifact === 'string' && artifact.toLowerCase().endsWith('.zip'),
  );
  if (dmgs.length !== 1 || zips.length !== 1) {
    throw new Error(`desktop-release.unexpected-artifact: ${artifacts.map(String).join(', ')}`);
  }
  const [dmg] = dmgs;
  const [zip] = zips;
  if (path.basename(zip) !== expectedDarwinArm64ZipName(version)) {
    throw new Error(`desktop-release.zip-name-invalid: ${path.basename(zip)}`);
  }
  if (!existsSync(dmg)) {
    throw new Error(`desktop-release.dmg-missing: ${dmg}`);
  }
  if (!existsSync(zip)) {
    throw new Error(`desktop-release.zip-missing: ${zip}`);
  }
  return Object.freeze({ dmg, zip });
};

module.exports = {
  RELEASE_FLAG,
  ORACLE_FIXTURE_FLAG,
  ORACLE_CAPABILITY_NONCE,
  RELEASE_ENTITLEMENTS_PATH,
  REQUIRED_ENVIRONMENT,
  createDesktopBuildProvenance,
  createDesktopUpdateOracleForgeSettings,
  createDesktopReleaseProvenance,
  createDesktopReleaseForgeSettings,
  expectedDarwinArm64ZipName,
  validateDesktopReleaseMakeResults,
};
