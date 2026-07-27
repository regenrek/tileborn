#!/usr/bin/env node
/* global process */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const desktopRoot = path.join(repoRoot, 'apps/desktop');
const packagedApp = path.join(desktopRoot, 'out/Tileborne-darwin-arm64/Tileborne.app');
const entitlements = path.join(desktopRoot, 'assets/entitlements.mac.plist');

const fail = (code, message) => {
  throw new Error(`${code}: ${message}`);
};

const run = (file, args, options = {}) =>
  execFileSync(file, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });

const parseArgs = (args) => {
  const values = {
    identity: process.env.TILEBORNE_APPLE_SIGNING_IDENTITY,
    team: process.env.TILEBORNE_APPLE_TEAM_ID,
    nonce: process.env.TILEBORNE_DESKTOP_ORACLE_CAPABILITY_NONCE,
    candidate: '/tmp/tileborne-release-A.dmg',
    updateArtifact: '/tmp/Tileborne-darwin-arm64-B.zip',
  };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      !key?.startsWith('--') ||
      !['identity', 'team', 'nonce', 'candidate', 'update-artifact'].includes(key.slice(2)) ||
      value === undefined
    ) {
      fail('oracle-builder.invalid-argument', key ?? '<missing>');
    }
    values[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (
    typeof values.identity !== 'string' ||
    !values.identity.startsWith('Developer ID Application:')
  ) {
    fail('oracle-builder.invalid-identity', 'Developer ID Application identity required');
  }
  if (typeof values.team !== 'string' || !/^[A-Z0-9]{10}$/.test(values.team)) {
    fail('oracle-builder.invalid-team', 'ten uppercase letters/digits required');
  }
  if (typeof values.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(values.nonce)) {
    fail('oracle-builder.invalid-nonce', '64 lowercase hex characters required');
  }
  return values;
};

const packageVersion = () =>
  JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')).version;

const incrementPatchVersion = (version) => {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (match === null) fail('oracle-builder.invalid-version', version);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
};

const createDmg = ({ appPath, dmgPath, identity }) => {
  rmSync(dmgPath, { force: true });
  run('/usr/bin/hdiutil', [
    'create',
    '-volname',
    'Tileborne',
    '-srcfolder',
    appPath,
    '-ov',
    '-format',
    'UDZO',
    dmgPath,
  ]);
  run('/usr/bin/codesign', ['--force', '--sign', identity, dmgPath]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', dmgPath]);
  run('/usr/bin/hdiutil', ['verify', dmgPath]);
};

const createZip = ({ appPath, zipPath }) => {
  rmSync(zipPath, { force: true });
  run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath]);
};

const packageSignedOracleApp = ({ version, sourceCommit, identity, team, nonce, destination }) => {
  run('pnpm', ['--filter', '@tileborne/desktop', 'build'], {
    env: {
      ...process.env,
      TILEBORNE_DESKTOP_RELEASE: '0',
      TILEBORNE_DESKTOP_UPDATE_ORACLE_FIXTURE: '1',
      TILEBORNE_DESKTOP_ORACLE_VERSION: version,
      TILEBORNE_SOURCE_COMMIT: sourceCommit,
      TILEBORNE_APPLE_SIGNING_IDENTITY: identity,
      TILEBORNE_APPLE_TEAM_ID: team,
      TILEBORNE_DESKTOP_ORACLE_CAPABILITY_NONCE: nonce,
    },
    stdio: 'inherit',
  });
  if (!existsSync(packagedApp)) {
    fail('oracle-builder.packaged-app-missing', packagedApp);
  }
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(path.dirname(destination), { recursive: true });
  run('/usr/bin/ditto', [packagedApp, destination]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', destination]);
};

const main = () => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    fail('oracle-builder.unsupported-host', `${process.platform}/${process.arch}`);
  }
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(entitlements)) {
    fail('oracle-builder.entitlements-missing', entitlements);
  }
  const sourceCommit = run('git', ['rev-parse', 'HEAD']).trim();
  const sourceVersion = packageVersion();
  const targetVersion = incrementPatchVersion(sourceVersion);

  const workRoot = mkdtempSync(path.join(os.tmpdir(), 'tileborne-update-oracle-fixtures-'));
  try {
    const appA = path.join(workRoot, 'A/Tileborne.app');
    const appB = path.join(workRoot, 'B/Tileborne.app');
    packageSignedOracleApp({
      version: sourceVersion,
      sourceCommit,
      identity: args.identity,
      team: args.team,
      nonce: args.nonce,
      destination: appA,
    });
    packageSignedOracleApp({
      version: targetVersion,
      sourceCommit,
      identity: args.identity,
      team: args.team,
      nonce: args.nonce,
      destination: appB,
    });

    createDmg({ appPath: appA, dmgPath: args.candidate, identity: args.identity });
    createZip({ appPath: appB, zipPath: args.updateArtifact });

    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        candidate: args.candidate,
        updateArtifact: args.updateArtifact,
        sourceVersion,
        targetVersion,
        sourceCommit,
        signingIdentity: args.identity,
        teamIdentifier: args.team,
        oracleCapabilityNonce: args.nonce,
        notarization: 'not-used-oracle-local-signed-fixtures',
      })}\n`,
    );
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
