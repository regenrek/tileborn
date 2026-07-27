import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';

export type E2eIsolationConfig = Readonly<{
  nonce: string;
  userDataDir: string;
  appDataDir: string;
  quitAfterStartupMarker: string;
}>;

type E2eIsolationEnvironment = Readonly<Record<string, string | undefined>>;

type E2eIsolationConfigFileSystem = Readonly<{
  existsSync(filePath: string): boolean;
  mkdirSync(filePath: string, options: { recursive: true }): unknown;
  realpathSync(filePath: string): string;
  readFileSync(filePath: string, encoding: 'utf8'): string;
  writeFileSync(filePath: string, bytes: string): void;
}>;

export type E2eIsolationConfigOptions = Readonly<{
  appPath: string;
  env: E2eIsolationEnvironment;
  execPath: string;
  fs?: Partial<E2eIsolationConfigFileSystem>;
}>;

const configFileName = '.tileborne-e2e-isolation.json';
const oracleCapabilityFileName = 'tileborne-desktop-update-oracle-capability.json';
const noncePattern = /^[a-f0-9]{64}$/;

const defaultFs: E2eIsolationConfigFileSystem = {
  existsSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  writeFileSync,
};

const isPathWithin = (root: string, candidate: string): boolean => {
  if (!path.isAbsolute(root) || !path.isAbsolute(candidate)) {
    return false;
  }
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const resolveRealContainedPath = (
  fs: E2eIsolationConfigFileSystem,
  root: string,
  candidate: string,
): string | undefined => {
  if (!path.isAbsolute(candidate)) {
    return undefined;
  }
  try {
    const realRoot = fs.realpathSync(root);
    const realCandidate = fs.existsSync(candidate)
      ? fs.realpathSync(candidate)
      : path.join(fs.realpathSync(path.dirname(candidate)), path.basename(candidate));
    return isPathWithin(realRoot, realCandidate) ? realCandidate : undefined;
  } catch {
    return undefined;
  }
};

const isVerifierIsolationRoot = (
  fs: E2eIsolationConfigFileSystem,
  isolationRoot: string,
): boolean => {
  try {
    const realRoot = fs.realpathSync(isolationRoot);
    const realTemp = fs.realpathSync(os.tmpdir());
    return (
      path.basename(realRoot).startsWith('tileborne-desktop-release-') &&
      isPathWithin(realTemp, realRoot)
    );
  } catch {
    return false;
  }
};

const readOracleCapabilityNonce = (
  fs: E2eIsolationConfigFileSystem,
  appPath: string,
): string | undefined => {
  const capabilityPath = path.join(appPath, '..', oracleCapabilityFileName);
  if (!fs.existsSync(capabilityPath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(capabilityPath, 'utf8')) as Partial<{
      schemaVersion: unknown;
      nonce: unknown;
    }>;
    return parsed.schemaVersion === 1 &&
      typeof parsed.nonce === 'string' &&
      noncePattern.test(parsed.nonce)
      ? parsed.nonce
      : undefined;
  } catch {
    return undefined;
  }
};

const parseScopedConfig = (
  fs: E2eIsolationConfigFileSystem,
  bytes: string,
  isolationRoot: string,
  expectedNonce: string,
): E2eIsolationConfig | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const candidate = parsed as Partial<E2eIsolationConfig>;
  if (
    candidate.nonce !== expectedNonce ||
    typeof candidate.userDataDir !== 'string' ||
    typeof candidate.appDataDir !== 'string' ||
    typeof candidate.quitAfterStartupMarker !== 'string'
  ) {
    return undefined;
  }
  if (!isVerifierIsolationRoot(fs, isolationRoot)) {
    return undefined;
  }
  const config: E2eIsolationConfig = {
    nonce: candidate.nonce,
    userDataDir: candidate.userDataDir,
    appDataDir: candidate.appDataDir,
    quitAfterStartupMarker: candidate.quitAfterStartupMarker,
  };
  const scopedPaths = [
    resolveRealContainedPath(fs, isolationRoot, config.userDataDir),
    resolveRealContainedPath(fs, isolationRoot, config.appDataDir),
    resolveRealContainedPath(fs, isolationRoot, config.quitAfterStartupMarker),
  ];
  return scopedPaths.every((value) => value !== undefined) ? config : undefined;
};

const configFromEnvironment = (
  fs: E2eIsolationConfigFileSystem,
  env: E2eIsolationEnvironment,
  configuredPath: string,
  expectedNonce: string,
): E2eIsolationConfig | undefined => {
  const isolationRoot = path.dirname(configuredPath);
  return parseScopedConfig(
    fs,
    JSON.stringify({
      nonce: env.TILEBORNE_E2E_ISOLATION_NONCE,
      userDataDir: env.TILEBORNE_E2E_USER_DATA_DIR,
      appDataDir: env.TILEBORNE_E2E_APP_DATA_DIR,
      quitAfterStartupMarker: env.TILEBORNE_E2E_QUIT_AFTER_STARTUP_MARKER,
    }),
    isolationRoot,
    expectedNonce,
  );
};

const readAncestorConfigBytes = (
  fs: E2eIsolationConfigFileSystem,
  candidate: string,
): string | undefined => {
  try {
    return fs.existsSync(candidate) ? String(fs.readFileSync(candidate, 'utf8')) : undefined;
  } catch {
    return undefined;
  }
};

export const findE2eIsolationConfig = ({
  appPath,
  env,
  execPath,
  fs: fsOverrides,
}: E2eIsolationConfigOptions): E2eIsolationConfig | undefined => {
  const fs = { ...defaultFs, ...fsOverrides };
  const expectedNonce = readOracleCapabilityNonce(fs, appPath);
  if (expectedNonce === undefined) {
    return undefined;
  }
  const configuredPath = env.TILEBORNE_E2E_ISOLATION_CONFIG;
  if (
    env.TILEBORNE_E2E === '1' &&
    typeof configuredPath === 'string' &&
    path.isAbsolute(configuredPath)
  ) {
    const config = configFromEnvironment(fs, env, configuredPath, expectedNonce);
    if (config !== undefined) {
      fs.mkdirSync(path.dirname(configuredPath), { recursive: true });
      fs.writeFileSync(configuredPath, `${JSON.stringify(config)}\n`);
      return config;
    }
  }

  let directory = path.dirname(execPath);
  for (let index = 0; index < 8; index += 1) {
    const candidate = path.join(directory, configFileName);
    const bytes = readAncestorConfigBytes(fs, candidate);
    if (bytes !== undefined) {
      const parsed = parseScopedConfig(fs, bytes, directory, expectedNonce);
      if (parsed !== undefined) {
        return parsed;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  return undefined;
};
