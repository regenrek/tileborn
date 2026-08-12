import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  createCiFastPlan,
  createReleaseGateMatrix,
  createReleaseGateReceipt,
  releaseGateReceiptSchemaVersion,
  releaseGates,
  resolveReleaseGate,
  selectReleaseGates,
  validateReleaseGateReceipt,
} from './release-gates.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('canonical release gates', () => {
  it('publishes unique, executable gates to the CI matrix without copying commands', () => {
    const ids = releaseGates.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(releaseGates.every(({ commands }) => commands.length > 0)).toBe(true);
    expect(
      releaseGates.every(({ commands }) => commands.every((command) => command.length > 0)),
    ).toBe(true);

    expect(createReleaseGateMatrix().include).toEqual(
      releaseGates.map(({ id, label, required, xvfb }) => ({
        id,
        label,
        profile: null,
        required,
        xvfb,
      })),
    );
  });

  it('defines deterministic fast, stable, and advisory gate profiles', () => {
    expect(selectReleaseGates('fast').map(({ id }) => id)).toEqual([
      'install',
      'format',
      'typecheck',
      'lint',
      'test',
      'build',
      'desktop-smoke',
      'packaged-runtime',
      'desktop-release-contract',
    ]);
    expect(selectReleaseGates('stable').map(({ id }) => id)).toEqual([
      'install',
      'format',
      'typecheck',
      'lint',
      'test',
      'build',
      'boundaries',
      'cli-e2e',
      'game-host',
      'bundled-worker',
      'services-build-hermetic',
      'creator-performance',
      'docs',
      'desktop-smoke',
      'packaged-runtime',
      'desktop-release-contract',
      'clean-checkout',
    ]);
    expect(selectReleaseGates('advisory').map(({ id, required }) => ({ id, required }))).toEqual([
      { id: 'creator-performance-native', required: false },
      { id: 'clean-checkout-time', required: false },
    ]);

    expect(createReleaseGateMatrix('fast').include).toEqual(
      selectReleaseGates('fast').map(({ id, label, required, xvfb }) => ({
        id,
        label,
        profile: 'fast',
        required,
        xvfb,
      })),
    );
    expect(selectReleaseGates('fast').map(({ id, commands }) => ({ id, commands }))).toEqual([
      { id: 'install', commands: [['pnpm', 'install', '--frozen-lockfile']] },
      { id: 'format', commands: [['pnpm', 'format:check']] },
      { id: 'typecheck', commands: [['pnpm', 'turbo', 'run', 'typecheck', '--affected']] },
      { id: 'lint', commands: [['pnpm', 'turbo', 'run', 'lint', '--affected']] },
      { id: 'test', commands: [['pnpm', 'turbo', 'run', 'test', '--affected', '--', '--run']] },
      {
        id: 'build',
        commands: [
          ['pnpm', 'turbo', 'run', 'build', '--affected', '--filter=@tileborne/desktop...'],
        ],
      },
      {
        id: 'desktop-smoke',
        commands: [
          ['pnpm', 'turbo', 'run', 'build', '--filter=@tileborne/desktop...'],
          ['pnpm', 'test:desktop-smoke'],
        ],
      },
      {
        id: 'packaged-runtime',
        commands: [
          ['pnpm', 'turbo', 'run', 'build', '--filter=@tileborne/desktop...'],
          ['pnpm', '--filter', '@tileborne/desktop', 'test:packaged-smoke'],
        ],
      },
      {
        id: 'desktop-release-contract',
        commands: [
          ['pnpm', 'release:desktop:policy'],
          ['pnpm', 'release:desktop:status'],
          ['pnpm', 'release:desktop:docs'],
          ['pnpm', 'test:desktop-release-contract'],
        ],
      },
    ]);
    expect(() => selectReleaseGates('experimental')).toThrow(/Unknown release gate profile/);
  });

  it('requires deterministic creator budgets and keeps native timing advisory', () => {
    const deterministic = releaseGates.find(({ id }) => id === 'creator-performance');
    const native = releaseGates.find(({ id }) => id === 'creator-performance-native');

    expect(deterministic).toMatchObject({
      required: true,
      xvfb: false,
      commands: [
        ['pnpm', 'turbo', 'run', 'build', '--filter=@tileborne/desktop^...'],
        ['pnpm', 'test:creator-performance'],
      ],
    });
    expect(native).toMatchObject({
      required: false,
      xvfb: true,
      commands: [
        ['pnpm', 'turbo', 'run', 'build', '--filter=@tileborne/desktop^...'],
        ['pnpm', '--filter', '@tileborne/desktop', 'test:creator-performance-native'],
      ],
    });
  });

  it('requires the fail-closed desktop release contract without claiming a distributable', () => {
    const desktopRelease = releaseGates.find(({ id }) => id === 'desktop-release-contract');

    expect(desktopRelease).toMatchObject({
      required: true,
      xvfb: false,
      commands: [
        ['pnpm', 'release:desktop:policy'],
        ['pnpm', 'release:desktop:status'],
        ['pnpm', 'release:desktop:docs'],
        ['pnpm', 'test:desktop-release-contract'],
      ],
    });
    const rootPackage = JSON.parse(read('package.json')) as {
      readonly scripts: Record<string, string>;
    };
    expect(rootPackage.scripts['release:desktop:status']).toContain('--expect no-go');
    expect(rootPackage.scripts['release:desktop:verify']).not.toContain('--expect no-go');
  });

  it('makes root CI delegate to the canonical runner', () => {
    const rootPackage = JSON.parse(read('package.json')) as {
      readonly scripts: Record<string, string>;
    };
    const turbo = JSON.parse(read('turbo.json')) as {
      readonly tasks: Record<string, { readonly dependsOn?: readonly string[] }>;
    };

    expect(rootPackage.scripts.ci).toBe('pnpm ci:fast');
    expect(rootPackage.scripts['ci:fast']).toBe('pnpm release:gates:ci-fast');
    expect(rootPackage.scripts['release:gates']).toBe('node scripts/release-gates.mjs run-all');
    expect(rootPackage.scripts['release:gate']).toBe('node scripts/release-gates.mjs run');
    expect(rootPackage.scripts['release:gates:ci-fast']).toBe(
      'node scripts/release-gates.mjs ci-fast',
    );
    expect(rootPackage.scripts['release:gates:matrix']).toBe(
      'node scripts/release-gates.mjs matrix',
    );
    expect(rootPackage.scripts.test).toBe('turbo run test --concurrency=1');
    expect(turbo.tasks['@tileborne/services-build#test']?.dependsOn).toContain(
      '@tileborne/cli#build',
    );
  });

  it('makes GitHub Actions expose one affected-scope ci-fast summary check', () => {
    const workflow = read('.github/workflows/ci.yml');

    expect(workflow).toContain('ci-fast:');
    expect(workflow).toContain('name: ci-fast');
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('TURBO_SCM_BASE:');
    expect(workflow).toContain('TURBO_SCM_HEAD: ${{ github.sha }}');
    expect(workflow).toContain('sudo apt-get update && sudo apt-get install -y xvfb');
    expect(workflow).toContain('run: xvfb-run -a node scripts/release-gates.mjs ci-fast');
    expect(workflow).toContain('run: corepack enable');
    expect(read('scripts/release-gates.mjs')).toContain('GITHUB_STEP_SUMMARY');
    expect(read('scripts/release-gates.mjs')).toContain('Escalations');
    expect(read('scripts/release-gates.mjs')).toContain('Turbo command');
    expect(workflow).not.toContain('pnpm/action-setup');
    expect(workflow).not.toContain('release-gate-plan');
    expect(workflow).not.toContain('strategy:');
    expect(workflow).not.toContain('matrix:');
    expect(workflow).not.toContain('continue-on-error:');

    for (const command of [
      'pnpm release:gates:matrix',
      'pnpm release:gate',
      'pnpm format:check',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test -- --run',
      'pnpm build',
      'pnpm test:boundaries',
      'pnpm test:cli-e2e',
      'pnpm test:desktop-smoke',
      'pnpm docs:build',
    ]) {
      expect(workflow).not.toContain(`run: ${command}`);
    }
  });

  it('prepares the required-check ruleset for only ci-fast', () => {
    const ruleset = JSON.parse(read('.github/rulesets/ci-fast-required-check.json')) as {
      readonly name: string;
      readonly target: string;
      readonly enforcement: string;
      readonly rules: readonly {
        readonly type: string;
        readonly parameters: {
          readonly required_status_checks: readonly { readonly context: string }[];
        };
      }[];
    };
    const requiredStatusChecks = ruleset.rules.flatMap(
      (rule) => rule.parameters.required_status_checks ?? [],
    );

    expect(ruleset).toMatchObject({
      name: 'Require ci-fast',
      target: 'branch',
      enforcement: 'evaluate',
    });
    expect(requiredStatusChecks.map(({ context }) => context)).toEqual(['ci-fast']);
  });

  it('adds an exact-SHA macOS arm64 release-fast candidate workflow', () => {
    const workflow = read('.github/workflows/release-fast.yml');

    expect(workflow).toContain('name: release-fast');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('source_sha:');
    expect(workflow).toContain('version:');
    expect(workflow).toContain('publish_prerelease:');
    expect(workflow).toContain('runs-on: macos-15');
    expect(workflow).not.toContain('macos-latest');
    expect(workflow).toContain('group: release-fast-${{ inputs.source_sha }}');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('[[ ! "$SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]]');
    expect(workflow).toContain('ref: ${{ inputs.source_sha }}');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$SOURCE_SHA"');
    expect(workflow).toContain(
      'PACKAGE_VERSION="$(node -p "require(\'./apps/desktop/package.json\').version")"',
    );
    expect(workflow).toContain('TILEBORNE_CI_FAST_RECEIPT:');
    expect(workflow).toContain(
      'pnpm release:gates:ci-fast -- --changed-path apps/desktop/src/main/main.ts',
    );
    expect(workflow).toContain("'desktop-smoke'");
    expect(workflow).toContain("'packaged-runtime'");
    expect(workflow).toContain("TILEBORNE_DESKTOP_RELEASE: '1'");
    expect(workflow).toContain('pnpm --filter @tileborne/desktop package');
    expect(workflow).toContain('pnpm release:desktop:manifest');
    expect(workflow).toContain('--source-commit "$SOURCE_SHA"');
    expect(workflow).toContain('native-candidate-verification-receipt.json');
    expect(workflow).toContain('node scripts/macos-desktop-release-verifier.mjs \\');
    expect(workflow).toContain('--candidate "$BUNDLE_DMG"');
    expect(workflow).toContain('--update-artifact "$BUNDLE_ZIP"');
    expect(workflow).toContain('--candidate-only 1 > "$NATIVE_RECEIPT"');
    expect(workflow).toContain("receipt.candidate.candidateStaple !== 'validated'");
    expect(workflow).toContain("receipt.candidate.candidateGatekeeper !== 'accepted'");
    expect(workflow).toContain('(cd "$BUNDLE_DIR" && shasum -a 256 ./* > checksums.sha256)');
    expect(workflow).toContain(
      'uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    );
    expect(workflow).toContain('name: ${{ env.BUNDLE_NAME }}');
    expect(workflow).toContain('if: ${{ inputs.publish_prerelease }}');
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('test "$TILEBORNE_DESKTOP_PUBLISH_APPROVED" = "1"');
    expect(workflow).toContain('gh run download "$GITHUB_RUN_ID"');
    expect(workflow).toContain('--name "tileborne-macos-arm64-fast-$SOURCE_SHA"');
    expect(workflow).toContain('TAG="desktop-fast-$SOURCE_SHA"');
    expect(workflow).toContain(
      'gh release view "$TAG" --json targetCommitish,isPrerelease,isDraft,assets',
    );
    expect(workflow).toContain('release.targetCommitish !== source');
    expect(workflow).toContain('release.isPrerelease !== true');
    expect(workflow).toContain('release.isDraft !== false');
    expect(workflow).toContain("failures.push('assets')");
    expect(workflow).toContain('gh release download "$TAG"');
    expect(workflow).toContain('shasum -a 256 -c checksums.sha256');
    expect(workflow).toContain(
      'LATEST_TAG="$(gh release view --json tagName -q .tagName 2>/dev/null || true)"',
    );
    expect(workflow).toContain('"$RUNNER_TEMP/release-bundle"/*');
    expect(workflow).toContain('--prerelease');
    expect(workflow).toContain('--latest=false');
    expect(workflow).not.toContain('TAG="stable');
    expect(workflow).not.toContain('TAG="v$VERSION"');
    expect(workflow).not.toContain('--latest=true');
    expect(workflow).not.toContain('refs/heads/main');
  });

  it('adds a protected exact-SHA macOS arm64 release-stable workflow', () => {
    const workflow = read('.github/workflows/release-stable.yml');

    expect(workflow).toContain('name: release-stable');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('source_sha:');
    expect(workflow).toContain('version:');
    expect(workflow).toContain('publish_release:');
    expect(workflow).toContain('runs-on: macos-15');
    expect(workflow).not.toContain('macos-latest');
    expect(workflow).toContain('group: release-stable-${{ inputs.source_sha }}');
    expect(workflow).toContain('cancel-in-progress: false');
    const stableCandidateBlock = workflow.slice(
      workflow.indexOf('  stable-candidate:'),
      workflow.indexOf('  stable-publication:'),
    );
    const stablePublicationBlock = workflow.slice(workflow.indexOf('  stable-publication:'));
    expect(stableCandidateBlock).toContain('name: release-stable-candidate');
    expect(stableCandidateBlock).toContain('environment: stable-build-secrets');
    expect(stableCandidateBlock).not.toContain('environment: stable-release');
    expect(stableCandidateBlock).toContain('permissions:\n      contents: read');
    expect(workflow).toContain('[[ ! "$SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]]');
    expect(workflow).toContain('ref: ${{ inputs.source_sha }}');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$SOURCE_SHA"');
    expect(workflow).toContain(
      'PACKAGE_VERSION="$(node -p "require(\'./apps/desktop/package.json\').version")"',
    );
    expect(workflow).toContain('TILEBORNE_STABLE_GATE_RECEIPT:');
    expect(workflow).toContain(
      'node scripts/release-gates.mjs run-profile stable --receipt "$TILEBORNE_STABLE_GATE_RECEIPT"',
    );
    expect(workflow).toContain("selectReleaseGates('stable').map(({ id }) => id)");
    expect(workflow).toContain("TILEBORNE_DESKTOP_RELEASE: '1'");
    expect(workflow).toContain(
      "import { decrementPatchVersion } from './scripts/macos-desktop-release-verifier.mjs'",
    );
    expect(workflow).toContain('manifest.version = process.env.PREVIOUS_VERSION');
    expect(workflow).toContain('BUNDLE_PREVIOUS_DMG="$BUNDLE_DIR/retained-previous-');
    expect(workflow).toContain(
      'TILEBORNE_SOURCE_COMMIT="$SOURCE_SHA" pnpm --filter @tileborne/desktop package',
    );
    expect(workflow).toContain('pnpm release:desktop:manifest');
    expect(workflow).toContain('--source-commit "$SOURCE_SHA"');
    expect(workflow).toContain('native-stable-verification-receipt.json');
    expect(workflow).toContain('native-stable-update-verification-receipt.json');
    expect(workflow).toContain('node scripts/macos-desktop-release-verifier.mjs \\');
    expect(workflow).toContain('--candidate "$BUNDLE_DMG"');
    expect(workflow).toContain('--candidate "$BUNDLE_PREVIOUS_DMG"');
    expect(workflow).toContain('--candidate-only 1 > "$NATIVE_RECEIPT"');
    expect(workflow).toContain(
      'updateReceipt.candidate.embeddedVersion !== previousVersion || updateReceipt.install.sourceVersion !== previousVersion || updateReceipt.install.targetVersion !== version',
    );
    expect(workflow).toContain('(cd "$BUNDLE_DIR" && shasum -a 256 ./* > checksums.sha256)');
    expect(workflow).toContain(
      'uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    );
    expect(workflow).toContain('name: ${{ env.BUNDLE_NAME }}');
    expect(stablePublicationBlock).toContain('environment: stable-release');
    expect(stablePublicationBlock).toContain('name: release-stable-protected-publication');
    expect(stablePublicationBlock).toContain('contents: write');
    expect(workflow).toContain('if: ${{ ! inputs.publish_release }}');
    expect(workflow).toContain('Publication was not requested; no tag or release was created.');
    expect(workflow).toContain('if: ${{ inputs.publish_release }}');
    expect(workflow).toContain('test "$TILEBORNE_DESKTOP_PUBLISH_APPROVED" = "1"');
    expect(workflow).toContain('gh run download "$GITHUB_RUN_ID"');
    expect(workflow).toContain('--name "tileborne-macos-arm64-stable-$SOURCE_SHA"');
    expect(workflow).toContain('TAG="desktop-v$VERSION"');
    expect(workflow).toContain(
      'gh release view "$TAG" --json targetCommitish,isPrerelease,isDraft,isLatest,assets',
    );
    expect(workflow).toContain('release.targetCommitish !== source');
    expect(workflow).toContain('release.isPrerelease !== false');
    expect(workflow).toContain('release.isDraft !== false');
    expect(workflow).toContain('"$RUNNER_TEMP/release-bundle"/*');
    expect(workflow).toContain('--latest');
    expect(workflow).not.toContain('--prerelease');
    expect(workflow).not.toContain('refs/heads/main');

    const contentsWriteOccurrences = workflow.match(/contents: write/g) ?? [];
    expect(contentsWriteOccurrences).toHaveLength(1);
    expect(workflow.indexOf('stable-candidate:')).toBeLessThan(
      workflow.indexOf('stable-publication:'),
    );
    expect(workflow.indexOf('--candidate "$BUNDLE_PREVIOUS_DMG"')).toBeGreaterThan(
      workflow.indexOf('--candidate "$BUNDLE_DMG"'),
    );
  });

  it('moves unsupported platforms and timing-only coverage into non-blocking advisory workflow', () => {
    const workflow = read('.github/workflows/release-advisory.yml');
    const ciWorkflow = read('.github/workflows/ci.yml');
    const ruleset = JSON.parse(read('.github/rulesets/ci-fast-required-check.json')) as {
      readonly rules: readonly {
        readonly parameters: {
          readonly required_status_checks: readonly { readonly context: string }[];
        };
      }[];
    };
    const requiredStatusChecks = ruleset.rules.flatMap(
      (rule) => rule.parameters.required_status_checks ?? [],
    );

    expect(workflow).toContain('name: release-advisory');
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain("cron: '17 3 * * 2'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).not.toContain('push:');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('release-advisory-timing-and-native-confidence');
    expect(workflow).toContain(
      'node scripts/release-gates.mjs run-profile advisory --receipt "$TILEBORNE_ADVISORY_RECEIPT"',
    );
    expect(workflow).toContain("selectReleaseGates('advisory').map(({ id }) => id)");
    expect(workflow).toContain('release-advisory-unsupported-${{ matrix.platform }}');
    expect(workflow).toContain('fail-fast: false');
    expect(workflow).toContain('platform: linux-x64');
    expect(workflow).toContain('platform: windows-x64');
    expect(workflow).toContain('platform: macos-x64');
    expect(workflow).toContain('runner: ubuntu-latest');
    expect(workflow).toContain('runner: windows-latest');
    expect(workflow).toContain('runner: macos-13');
    expect(workflow).toContain('Support status | unsupported for desktop 1.0');
    expect(workflow).toContain('Blocking | false');
    expect(workflow).not.toContain('contents: write');

    const continueOnErrorOccurrences = workflow.match(/continue-on-error: true/g) ?? [];
    expect(continueOnErrorOccurrences).toHaveLength(2);
    expect(ciWorkflow).not.toContain('release-advisory');
    expect(ciWorkflow).not.toContain('windows-latest');
    expect(ciWorkflow).not.toContain('macos-13');
    expect(requiredStatusChecks.map(({ context }) => context)).toEqual(['ci-fast']);
  });

  it('plans one affected Turbo command without unrelated desktop release contracts', () => {
    const plan = createCiFastPlan({
      base: 'base-sha',
      head: 'head-sha',
      changedPaths: ['packages/core/src/index.ts'],
    });

    expect(plan).toMatchObject({
      profile: 'fast',
      base: 'base-sha',
      head: 'head-sha',
      changedPaths: ['packages/core/src/index.ts'],
      escalations: [],
    });
    expect(
      plan.commands.filter((command) => command[0] === 'pnpm' && command[1] === 'turbo'),
    ).toEqual([['pnpm', 'turbo', 'run', 'build', 'lint', 'typecheck', 'test', '--affected']]);
    expect(plan.commands).toContainEqual(['pnpm', 'format:check']);
    expect(plan.commands).not.toContainEqual(['pnpm', 'release:desktop:policy']);
    expect(plan.commands).not.toContainEqual(['pnpm', 'release:desktop:status']);
    expect(plan.commands).not.toContainEqual(['pnpm', 'release:desktop:docs']);
    expect(plan.commands).not.toContainEqual(['pnpm', 'test:desktop-release-contract']);
    expect(plan.steps.map(({ gateIds }) => gateIds)).toEqual([
      ['install'],
      ['build', 'lint', 'typecheck', 'test'],
      ['format'],
    ]);
  });

  it('escalates docs-only and representative desktop changes through the canonical owner table', () => {
    const docsPlan = createCiFastPlan({
      base: 'base-sha',
      head: 'head-sha',
      changedPaths: ['docs/desktop-release-runbook.md'],
    });
    const desktopPlan = createCiFastPlan({
      base: 'base-sha',
      head: 'head-sha',
      changedPaths: ['apps/desktop/src/main/main.ts'],
    });
    const rootPlan = createCiFastPlan({
      base: 'base-sha',
      head: 'head-sha',
      changedPaths: [
        'package.json',
        'pnpm-lock.yaml',
        '.github/workflows/ci.yml',
        'scripts/release-gates.mjs',
      ],
    });

    expect(docsPlan.escalations.map(({ id }) => id)).toEqual(['docs']);
    expect(docsPlan.commands[1]).toEqual([
      'pnpm',
      'turbo',
      'run',
      'build',
      'lint',
      'typecheck',
      'test',
      '--affected',
      '--filter',
      '@tileborne/docs...',
    ]);
    expect(docsPlan.commands).toContainEqual(['pnpm', 'test:desktop-release-contract']);
    expect(desktopPlan.escalations.map(({ id }) => id)).toEqual(['desktop']);
    expect(desktopPlan.commands[1]).toContain('@tileborne/desktop...');
    expect(desktopPlan.commands).toContainEqual(['pnpm', 'test:desktop-smoke']);
    expect(desktopPlan.commands).toContainEqual([
      'pnpm',
      '--filter',
      '@tileborne/desktop',
      'test:packaged-smoke',
    ]);
    expect(
      desktopPlan.commands.filter(
        (command) => command[0] === 'pnpm' && command[1] === 'turbo' && command.includes('build'),
      ),
    ).toHaveLength(1);
    expect(desktopPlan.steps.map(({ gateIds }) => gateIds)).toContainEqual(['desktop-smoke']);
    expect(desktopPlan.steps.map(({ gateIds }) => gateIds)).toContainEqual(['packaged-runtime']);
    expect(rootPlan.escalations.map(({ id }) => id)).toEqual([
      'root-config',
      'lockfile',
      'release-scripts',
      'workflows',
    ]);
    expect(rootPlan.commands[1]).toEqual([
      'pnpm',
      'turbo',
      'run',
      'build',
      'lint',
      'typecheck',
      'test',
      '--affected',
      '--filter',
      '@tileborne/desktop...',
      '--filter',
      '@tileborne/docs...',
      '--filter',
      '@tileborne/game-host...',
    ]);
  });

  it('emits ci-fast receipts with canonical gate ids that validate fail-closed', () => {
    const desktopPlan = createCiFastPlan({
      base: 'base-sha',
      head: 'head-sha',
      changedPaths: ['apps/desktop/src/main/main.ts'],
    });
    const receipt = createReleaseGateReceipt({
      profile: 'fast',
      sourceSha: 'head-sha',
      lockfileHash: 'sha256:lockfile',
      nodeVersion: 'v22.0.0',
      packageManagerVersion: '11.8.0',
      startedAt: '2026-07-27T10:00:00.000Z',
      finishedAt: '2026-07-27T10:01:00.000Z',
      gateResults: [...new Set(desktopPlan.steps.flatMap((step) => step.gateIds))].map(
        (gateId) => ({
          id: gateId,
          status: 'passed',
          startedAt: '2026-07-27T10:00:00.000Z',
          finishedAt: '2026-07-27T10:00:01.000Z',
        }),
      ),
      artifactPaths: [],
    });
    const emittedGateIds = receipt.gates.map(({ id }) => id);

    expect(emittedGateIds).toEqual([
      'install',
      'build',
      'lint',
      'typecheck',
      'test',
      'format',
      'desktop-release-contract',
      'desktop-smoke',
      'packaged-runtime',
    ]);
    expect(
      validateReleaseGateReceipt(receipt, {
        profile: 'fast',
        sourceSha: 'head-sha',
        lockfileHash: 'sha256:lockfile',
        gateIds: [...new Set(emittedGateIds)],
      }),
    ).toBe(true);
  });

  it('executes ci-fast orchestration into receipt and summary outputs for desktop scope', () => {
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'tileborne-ci-fast-'));
    const binDirectory = path.join(temporaryDirectory, 'bin');
    const fakePnpmPath = path.join(binDirectory, 'pnpm');
    const commandLogPath = path.join(temporaryDirectory, 'pnpm-commands.log');
    const receiptPath = path.join(temporaryDirectory, 'receipt.json');
    const summaryPath = path.join(temporaryDirectory, 'summary.md');

    try {
      mkdirSync(binDirectory, { recursive: true });
      writeFileSync(
        fakePnpmPath,
        [
          '#!/usr/bin/env bash',
          'set -euo pipefail',
          'if [[ "${1:-}" == "--version" ]]; then',
          '  echo "11.8.0"',
          '  exit 0',
          'fi',
          'printf "%s\\n" "$*" >> "$TILEBORNE_FAKE_PNPM_LOG"',
        ].join('\n'),
      );
      chmodSync(fakePnpmPath, 0o755);

      const result = spawnSync(
        process.execPath,
        ['scripts/release-gates.mjs', 'ci-fast', '--changed-path', 'apps/desktop/src/main/main.ts'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
            GITHUB_STEP_SUMMARY: summaryPath,
            TILEBORNE_CI_FAST_RECEIPT: receiptPath,
            TILEBORNE_FAKE_PNPM_LOG: commandLogPath,
            TURBO_SCM_BASE: 'base-sha',
            TURBO_SCM_HEAD: 'head-sha',
          },
        },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(commandLogPath, 'utf8').trimEnd().split('\n')).toEqual([
        'install --frozen-lockfile',
        'turbo run build lint typecheck test --affected --filter @tileborne/desktop...',
        'format:check',
        'release:desktop:policy',
        'release:desktop:status',
        'release:desktop:docs',
        'test:desktop-release-contract',
        'test:desktop-smoke',
        '--filter @tileborne/desktop test:packaged-smoke',
      ]);

      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
        readonly profile: string;
        readonly sourceSha: string;
        readonly lockfileHash: string;
        readonly artifactHashes: readonly [];
        readonly gates: readonly { readonly id: string; readonly status: string }[];
      };
      const expectedGateIds = [
        'install',
        'build',
        'lint',
        'typecheck',
        'test',
        'format',
        'desktop-release-contract',
        'desktop-smoke',
        'packaged-runtime',
      ];

      expect(receipt.gates.map(({ id }) => id)).toEqual(expectedGateIds);
      expect(receipt.gates.every(({ status }) => status === 'passed')).toBe(true);
      expect(
        validateReleaseGateReceipt(receipt, {
          profile: 'fast',
          sourceSha: 'head-sha',
          lockfileHash: receipt.lockfileHash,
          gateIds: expectedGateIds,
          artifactHashes: receipt.artifactHashes,
        }),
      ).toBe(true);
      expect(readFileSync(summaryPath, 'utf8')).toContain('| Escalations | desktop:');
      expect(readFileSync(summaryPath, 'utf8')).toContain(`| Receipt | ${receiptPath} |`);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('writes a parseable matrix to the GitHub Actions output contract', () => {
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'tileborne-release-gates-'));
    const githubOutput = path.join(temporaryDirectory, 'github-output');

    try {
      const result = spawnSync(process.execPath, ['scripts/release-gates.mjs', 'matrix'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: githubOutput },
      });

      expect(result.status, result.stderr).toBe(0);
      const output = readFileSync(githubOutput, 'utf8');
      expect(output.endsWith('\n')).toBe(true);
      const [assignment, ...unexpectedLines] = output.trimEnd().split('\n');
      expect(unexpectedLines).toEqual([]);
      expect(assignment).toMatch(/^matrix=/);
      expect(JSON.parse(assignment!.slice('matrix='.length))).toEqual(createReleaseGateMatrix());
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('resolves profiled matrix rows through their profile-specific commands', () => {
    expect(resolveReleaseGate('fast', 'typecheck').commands).toEqual([
      ['pnpm', 'turbo', 'run', 'typecheck', '--affected'],
    ]);
    expect(resolveReleaseGate(undefined, 'typecheck').commands).toEqual([['pnpm', 'typecheck']]);
    expect(() => resolveReleaseGate('fast', 'clean-checkout')).toThrow(/Unknown release gate/);
  });

  it('rejects dry-run profile execution before writing a receipt', () => {
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'tileborne-release-dry-run-'));
    const receiptPath = path.join(temporaryDirectory, 'receipt.json');

    try {
      const result = spawnSync(
        process.execPath,
        ['scripts/release-gates.mjs', 'run-profile', 'stable', '--receipt', receiptPath],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: { ...process.env, TILEBORNE_RELEASE_GATE_DRY_RUN: '1' },
        },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'run-profile cannot run with TILEBORNE_RELEASE_GATE_DRY_RUN=1',
      );
      expect(existsSync(receiptPath)).toBe(false);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('creates SHA- and lockfile-bound receipts with artifact hashes', () => {
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'tileborne-release-receipt-'));
    const artifactPath = path.join(temporaryDirectory, 'candidate.txt');

    try {
      writeFileSync(artifactPath, 'candidate artifact\n');
      const receipt = createReleaseGateReceipt({
        profile: 'fast',
        sourceSha: '0123456789abcdef0123456789abcdef01234567',
        lockfileHash: 'sha256:lockfile',
        nodeVersion: 'v22.0.0',
        packageManagerVersion: '11.8.0',
        startedAt: '2026-07-27T10:00:00.000Z',
        finishedAt: '2026-07-27T10:01:00.000Z',
        gateResults: [
          {
            id: 'install',
            status: 'passed',
            startedAt: '2026-07-27T10:00:00.000Z',
            finishedAt: '2026-07-27T10:00:05.000Z',
          },
        ],
        artifactPaths: [artifactPath],
      });

      expect(receipt).toMatchObject({
        schemaVersion: releaseGateReceiptSchemaVersion,
        profile: 'fast',
        sourceSha: '0123456789abcdef0123456789abcdef01234567',
        lockfileHash: 'sha256:lockfile',
        nodeVersion: 'v22.0.0',
        packageManager: 'pnpm@11.8.0',
        gates: [{ id: 'install', status: 'passed' }],
      });
      expect(receipt.artifactHashes).toEqual([
        {
          path: artifactPath,
          hash: 'sha256:0e02297fb55098e1f7c96e078707d0c4048d0dd3bda0fa2074bb7552cdb592de',
        },
      ]);
      expect(
        validateReleaseGateReceipt(receipt, {
          profile: 'fast',
          sourceSha: '0123456789abcdef0123456789abcdef01234567',
          lockfileHash: 'sha256:lockfile',
          gateIds: ['install'],
          artifactHashes: receipt.artifactHashes,
        }),
      ).toBe(true);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('fails closed on receipt profile, SHA, lockfile, schema, and artifact mismatches', () => {
    const receipt = createReleaseGateReceipt({
      profile: 'stable',
      sourceSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      lockfileHash: 'sha256:lockfile-a',
      nodeVersion: 'v22.0.0',
      packageManagerVersion: '11.8.0',
      startedAt: '2026-07-27T10:00:00.000Z',
      finishedAt: '2026-07-27T10:01:00.000Z',
      gateResults: [
        {
          id: 'clean-checkout',
          status: 'passed',
          startedAt: '2026-07-27T10:00:00.000Z',
          finishedAt: '2026-07-27T10:00:05.000Z',
        },
      ],
      artifactPaths: [],
    });

    expect(() =>
      validateReleaseGateReceipt(
        { ...receipt, schemaVersion: releaseGateReceiptSchemaVersion + 1 },
        {
          profile: 'fast',
          sourceSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          lockfileHash: 'sha256:lockfile-b',
          gateIds: ['clean-checkout'],
          artifactHashes: [{ path: 'candidate.dmg', hash: 'sha256:candidate' }],
        },
      ),
    ).toThrow(/schemaVersion, profile, sourceSha, lockfileHash, artifactHashes\.candidate\.dmg/);
    expect(() =>
      createReleaseGateReceipt({
        profile: 'fast',
        sourceSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        lockfileHash: 'sha256:lockfile-a',
        nodeVersion: 'v22.0.0',
        packageManagerVersion: '11.8.0',
        startedAt: '2026-07-27T10:00:00.000Z',
        finishedAt: '2026-07-27T10:01:00.000Z',
        gateResults: [
          {
            id: 'clean-checkout',
            status: 'passed',
            startedAt: '2026-07-27T10:00:00.000Z',
            finishedAt: '2026-07-27T10:00:05.000Z',
          },
        ],
      }),
    ).toThrow(/out-of-profile gate/);
    expect(() =>
      validateReleaseGateReceipt(receipt, {
        profile: 'stable',
        sourceSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        lockfileHash: 'sha256:lockfile-a',
      }),
    ).toThrow(/gates\.install/);
    expect(() =>
      validateReleaseGateReceipt(
        {
          ...receipt,
          profile: 'fast',
          gates: [
            {
              id: 'clean-checkout',
              status: 'passed',
              startedAt: '2026-07-27T10:00:00.000Z',
              finishedAt: '2026-07-27T10:00:01.000Z',
            },
          ],
        },
        {
          profile: 'fast',
          sourceSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          lockfileHash: 'sha256:lockfile-a',
          gateIds: ['clean-checkout'],
        },
      ),
    ).toThrow(/gates\.clean-checkout\.profile/);
    expect(() =>
      validateReleaseGateReceipt(
        {
          ...receipt,
          gates: [
            {
              id: 'install',
              status: 'failed',
              startedAt: '2026-07-27T10:00:00.000Z',
              finishedAt: '2026-07-27T10:00:01.000Z',
            },
            {
              id: 'install',
              status: 'passed',
              startedAt: '2026-07-27T10:00:01.000Z',
              finishedAt: '2026-07-27T10:00:02.000Z',
            },
          ],
        },
        {
          profile: 'stable',
          sourceSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          lockfileHash: 'sha256:lockfile-a',
          gateIds: ['install'],
        },
      ),
    ).toThrow(/gates\.install\.duplicate/);
    expect(() =>
      validateReleaseGateReceipt(
        {
          ...receipt,
          gates: [
            {
              id: 'install',
              status: 'passed',
              startedAt: '2026-07-27T10:00:00.000Z',
              finishedAt: '2026-07-27T10:00:01.000Z',
            },
            {
              id: 'typecheck',
              status: 'passed',
              startedAt: '2026-07-27T10:00:01.000Z',
              finishedAt: '2026-07-27T10:00:02.000Z',
            },
          ],
        },
        {
          profile: 'stable',
          sourceSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          lockfileHash: 'sha256:lockfile-a',
          gateIds: ['install'],
        },
      ),
    ).toThrow(/gates\.typecheck\.unexpected/);
  });
});
