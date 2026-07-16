import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildSanitizedChildEnvironment,
  inventoryRuntimeClosure,
  resolveRuntimeClosure,
  validateCleanCheckoutEvidence,
  validateBuildArtifact,
} from './external-shipped-artifact-oracle.mjs';
import { inventoryArtifact } from './shipped-artifact-evidence.mjs';

const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

const temporaryDirectory = (prefix: string): Promise<string> =>
  mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', prefix));

const commandEvidence = async (root: string, id: string) => {
  const stdout = `${id} stdout\n`;
  const stderr = `${id} stderr\n`;
  await Promise.all([
    writeFile(path.join(root, `${id}.stdout.log`), stdout),
    writeFile(path.join(root, `${id}.stderr.log`), stderr),
  ]);
  return {
    command: [id],
    exitCode: 0,
    signal: null,
    stdout: { file: `${id}.stdout.log`, bytes: Buffer.byteLength(stdout), sha256: sha256(stdout) },
    stderr: { file: `${id}.stderr.log`, bytes: Buffer.byteLength(stderr), sha256: sha256(stderr) },
  };
};

const cleanEvidenceFixture = async () => {
  const root = await temporaryDirectory('external-clean-evidence-');
  const checkoutRoot = path.join(root, 'checkout');
  const oracleRoot = path.join(root, 'oracle-artifacts');
  const shippedRoot = path.join(oracleRoot, 'shipped-game');
  await Promise.all([
    mkdir(checkoutRoot),
    mkdir(shippedRoot, { recursive: true }),
  ]);
  await writeFile(path.join(shippedRoot, 'worker.js'), 'worker');
  const gitHead = 'a'.repeat(40);
  const install = await commandEvidence(root, 'install');
  const predev = await commandEvidence(root, 'predev');
  const oracle = await commandEvidence(root, 'oracle');
  const preflight = {
    schemaVersion: 1,
    checkout: {
      cwd: checkoutRoot,
      cwdRealpath: checkoutRoot,
      repositoryRoot: checkoutRoot,
      gitHead,
      state: 'detached',
      symbolicRef: null,
      initialStatus: '',
      preexistingOutputs: [],
      postBuildStatus: '',
    },
    dependencyLinks: [],
    commands: { install, predev },
  };
  const preflightBytes = `${JSON.stringify(preflight, null, 2)}\n`;
  await writeFile(path.join(root, 'runner-preflight.json'), preflightBytes);
  const shippedArtifact = await inventoryArtifact(shippedRoot);
  const oracleReceipt = {
    schemaVersion: 1,
    runnerPreflight: {
      sha256: sha256(preflightBytes),
      gitHead,
      checkoutRoot,
      state: 'detached',
    },
    mapId: 'map:test',
    shippedArtifact: {
      sourceDirectory: shippedRoot,
      directory: 'shipped-game',
      ...shippedArtifact,
    },
  };
  const oracleReceiptBytes = `${JSON.stringify(oracleReceipt, null, 2)}\n`;
  await writeFile(path.join(oracleRoot, 'receipt.json'), oracleReceiptBytes);
  const runner = {
    schemaVersion: 1,
    checkoutRoot,
    gitHead,
    state: 'detached',
    preflight: { file: 'runner-preflight.json', sha256: sha256(preflightBytes) },
    oracle,
    oracleReceipt: {
      file: 'oracle-artifacts/receipt.json',
      bytes: Buffer.byteLength(oracleReceiptBytes),
      sha256: sha256(oracleReceiptBytes),
    },
    postOracleStatus: '',
  };
  const runnerPath = path.join(root, 'runner-receipt.json');
  await writeFile(runnerPath, `${JSON.stringify(runner, null, 2)}\n`);
  return { root, runnerPath, runner, preflight, oracleReceipt };
};

describe('external shipped artifact Oracle integrity', () => {
  it('binds the authoritative runner, preflight, commands, logs, inner receipt, and source artifact', async () => {
    const fixture = await cleanEvidenceFixture();
    await expect(validateCleanCheckoutEvidence(fixture.runnerPath)).resolves.toMatchObject({
      receipt: { path: fixture.runnerPath },
      runner: { gitHead: fixture.runner.gitHead, postOracleStatus: '' },
      commands: {
        install: { exitCode: 0, signal: null },
        predev: { exitCode: 0, signal: null },
        oracle: { exitCode: 0, signal: null },
      },
      sourceArtifactInventory: {
        files: fixture.oracleReceipt.shippedArtifact.files,
        treeSha256: fixture.oracleReceipt.shippedArtifact.treeSha256,
      },
    });
  });

  it('rejects mutated runner bindings, preflight bytes, and command logs', async () => {
    const badRunner = await cleanEvidenceFixture();
    await writeFile(
      badRunner.runnerPath,
      JSON.stringify({
        ...badRunner.runner,
        oracleReceipt: { ...badRunner.runner.oracleReceipt, sha256: '0'.repeat(64) },
      }),
    );
    await expect(validateCleanCheckoutEvidence(badRunner.runnerPath)).rejects.toThrow(
      'bound evidence sha256 mismatch',
    );

    const badPreflight = await cleanEvidenceFixture();
    await writeFile(path.join(badPreflight.root, 'runner-preflight.json'), 'mutated');
    await expect(validateCleanCheckoutEvidence(badPreflight.runnerPath)).rejects.toThrow(
      'bound evidence sha256 mismatch',
    );

    const badLog = await cleanEvidenceFixture();
    await writeFile(path.join(badLog.root, 'install.stdout.log'), 'mutated');
    await expect(validateCleanCheckoutEvidence(badLog.runnerPath)).rejects.toThrow(
      'bound evidence byte count mismatch',
    );
  });

  it('validates the durable record and rejects a shipped-file mutation', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'external-ship-oracle-')),
    );
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'worker.js'), 'worker');
    const fileHash = `sha256:${await import('node:crypto').then(({ createHash }) => createHash('sha256').update('worker').digest('hex'))}`;
    const manifest = { buildId: 'sha256:runtime' };
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    const manifestHash = `sha256:${await import('node:crypto').then(({ createHash }) => createHash('sha256').update(JSON.stringify(manifest)).digest('hex'))}`;
    const payload = {
      buildId: 'sha256:build',
      runtimeBuildId: manifest.buildId,
      files: ['manifest.json', 'worker.js'],
      fileHashes: { 'manifest.json': manifestHash, 'worker.js': fileHash },
    };
    const canonical = (value: unknown): string => {
      if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
      if (typeof value === 'number') return value.toString();
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
    };
    const integrityHash = `sha256:${await import('node:crypto').then(({ createHash }) => createHash('sha256').update(canonical(payload)).digest('hex'))}`;
    await writeFile(path.join(root, 'build-artifact.json'), JSON.stringify({ ...payload, integrityHash }));
    await expect(validateBuildArtifact(root)).resolves.toMatchObject({ record: { buildId: payload.buildId } });
    await writeFile(path.join(root, 'worker.js'), 'tampered');
    await expect(validateBuildArtifact(root)).rejects.toThrow('checksum mismatch: worker.js');
    expect(await readFile(path.join(root, 'worker.js'), 'utf8')).toBe('tampered');
  });

  it('allows only runtime-closure-internal symlink targets', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'external-runtime-closure-')),
    );
    await mkdir(path.join(root, 'bin'));
    await writeFile(path.join(root, 'bin', 'runtime'), 'runtime');
    await symlink('bin/runtime', path.join(root, 'runtime'));
    await expect(inventoryRuntimeClosure(root)).resolves.toMatchObject({ symlinks: [{ path: 'runtime', target: 'bin/runtime' }] });
    await symlink('/etc/hosts', path.join(root, 'escape'));
    await expect(inventoryRuntimeClosure(root)).rejects.toThrow('runtime symlink escapes closure');
  });

  it('rejects loader injection and emits only an explicit safe child environment', async () => {
    const runRoot = await temporaryDirectory('external-env-');
    const runtimeRoot = path.join(runRoot, 'runtime');
    await mkdir(runtimeRoot);
    await expect(
      buildSanitizedChildEnvironment({
        runRoot,
        runtimeRoot,
        inputEnvironment: { NODE_PATH: '/checkout/node_modules' },
      }),
    ).rejects.toThrow('dangerous Node environment injection rejected: NODE_PATH');
    await expect(
      buildSanitizedChildEnvironment({
        runRoot,
        runtimeRoot,
        inputEnvironment: { NODE_OPTIONS: '--require=/checkout/hook.cjs' },
      }),
    ).rejects.toThrow('dangerous Node environment injection rejected: NODE_OPTIONS');
    await expect(
      buildSanitizedChildEnvironment({
        runRoot,
        runtimeRoot,
        inputEnvironment: {},
        execArgv: ['--import=/checkout/hook.mjs'],
      }),
    ).rejects.toThrow('dangerous Node loader argument rejected');
    const sanitized = await buildSanitizedChildEnvironment({
      runRoot,
      runtimeRoot,
      inputEnvironment: { TILEBORNE_DEV_ROOT: '/checkout', SECRET_TOKEN: 'secret' },
    });
    expect(sanitized.environment).toEqual({
      HOME: path.join(runRoot, 'home'),
      TMPDIR: path.join(runRoot, 'tmp'),
      TMP: path.join(runRoot, 'tmp'),
      TEMP: path.join(runRoot, 'tmp'),
      PATH: [path.join(runtimeRoot, 'node_modules', '.bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter),
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      NO_COLOR: '1',
    });
    expect(sanitized.receipt.removedKeyCount).toBe(2);
    expect(sanitized.receipt.removedRepoSpecificKeys).toEqual(['TILEBORNE_DEV_ROOT']);
    expect(JSON.stringify(sanitized.receipt)).not.toContain('secret');
  });

  it('rejects runtimeMain escapes, missing closure dependencies, and Miniflare escapes', async () => {
    const runRoot = await temporaryDirectory('external-runtime-resolution-');
    const runtimeRoot = path.join(runRoot, 'runtime');
    const dist = path.join(runtimeRoot, 'dist');
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(runtimeRoot, 'package.json'), JSON.stringify({
      name: '@tileborne/cli',
      bin: { tileborne: './dist/main.js' },
    }));
    const runtimeMain = path.join(dist, 'main.js');
    await writeFile(runtimeMain, '');
    const escapedMain = path.join(await temporaryDirectory('external-main-escape-'), 'main.js');
    await writeFile(escapedMain, '');
    await expect(resolveRuntimeClosure({ runRoot, runtimeMain: escapedMain })).rejects.toThrow(
      'runtime closure escapes required root',
    );
    await expect(resolveRuntimeClosure({ runRoot, runtimeMain })).rejects.toThrow(
      'runtime closure dependency missing: miniflare',
    );

    const currentRequire = createRequire(import.meta.url);
    const currentMiniflareEntry = await realpath(currentRequire.resolve('miniflare'));
    const currentMiniflareRoot = path.resolve(path.dirname(currentMiniflareEntry), '../..');
    await mkdir(path.join(runtimeRoot, 'node_modules'), { recursive: true });
    await symlink(currentMiniflareRoot, path.join(runtimeRoot, 'node_modules', 'miniflare'));
    await expect(resolveRuntimeClosure({ runRoot, runtimeMain })).rejects.toThrow(
      'runtime dependency miniflare escapes required root',
    );
  });
});
