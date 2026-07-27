#!/usr/bin/env node

/* global console, process, setTimeout */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');

export const releaseDispatchUsage =
  'Usage: node scripts/release-dispatch.mjs --channel fast|stable|advisory [--sha <40-hex>] [--version <semver>] [--publish 0|1]';

const defaultCommandRunner = (command, commandArgs) =>
  execFileSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const parseReleaseDispatchArgs = (argv) =>
  Object.fromEntries(
    argv.flatMap((value, index, all) => {
      if (!value.startsWith('--') || value === '--') return [];
      return [[value.slice(2), all[index + 1]]];
    }),
  );

const workflowForChannel = (channel) => `release-${channel}.yml`;

const dispatchCommandFor = ({ channel, sourceSha, version, publish }) => {
  if (channel === 'fast') {
    return [
      'gh',
      [
        'workflow',
        'run',
        'release-fast.yml',
        '--ref',
        'main',
        '--raw-field',
        `source_sha=${sourceSha}`,
        '--raw-field',
        `version=${version}`,
        '--raw-field',
        `publish_prerelease=${publish ? 'true' : 'false'}`,
      ],
    ];
  }
  if (channel === 'stable') {
    return [
      'gh',
      [
        'workflow',
        'run',
        'release-stable.yml',
        '--ref',
        'main',
        '--raw-field',
        `source_sha=${sourceSha}`,
        '--raw-field',
        `version=${version}`,
        '--raw-field',
        `publish_release=${publish ? 'true' : 'false'}`,
      ],
    ];
  }
  return ['gh', ['workflow', 'run', 'release-advisory.yml', '--ref', 'main']];
};

const listRuns = ({ workflow, commandRunner }) =>
  JSON.parse(
    commandRunner('gh', [
      'run',
      'list',
      '--workflow',
      workflow,
      '--branch',
      'main',
      '--event',
      'workflow_dispatch',
      '--json',
      'databaseId,url,headSha,status,conclusion,createdAt',
      '-L',
      '20',
    ]),
  );

const newestRegisteredRun = (runs, existingRunIds) =>
  runs.find((candidate) => !existingRunIds.has(candidate.databaseId));

export async function dispatchRelease({
  args,
  commandRunner = defaultCommandRunner,
  sleep = defaultSleep,
  registrationAttempts = 6,
  registrationDelayMs = 5000,
  repo = repoRoot,
} = {}) {
  const channel = args.channel;
  if (!['fast', 'stable', 'advisory'].includes(channel)) {
    throw new Error(`release-dispatch.invalid-channel: ${channel ?? '<missing>'}`);
  }

  const sourceSha = args.sha ?? commandRunner('git', ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) {
    throw new Error(`release-dispatch.invalid-sha: ${sourceSha}`);
  }

  const version =
    args.version ??
    JSON.parse(readFileSync(path.join(repo, 'apps/desktop/package.json'), 'utf8')).version;
  if (channel !== 'advisory' && !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`release-dispatch.invalid-version: ${version}`);
  }

  const publish = args.publish === '1' || args.publish === 'true';
  const workflow = workflowForChannel(channel);
  const before = listRuns({ workflow, commandRunner });
  const existingRunIds = new Set(before.map(({ databaseId }) => databaseId));
  const [dispatchCommand, dispatchArgs] = dispatchCommandFor({
    channel,
    sourceSha,
    version,
    publish,
  });
  commandRunner(dispatchCommand, dispatchArgs);

  let dispatchedRun;
  for (let attempt = 0; attempt < registrationAttempts; attempt += 1) {
    if (attempt > 0 || registrationDelayMs > 0) await sleep(registrationDelayMs);
    const after = listRuns({ workflow, commandRunner });
    dispatchedRun = newestRegisteredRun(after, existingRunIds);
    if (dispatchedRun !== undefined) break;
  }
  if (dispatchedRun === undefined) {
    throw new Error(`release-dispatch.run-not-found: ${workflow} ${sourceSha}`);
  }

  return {
    schemaVersion: 1,
    channel,
    workflow,
    sourceSha,
    workflowHeadSha: dispatchedRun.headSha,
    version: channel === 'advisory' ? null : version,
    publishRequested: publish,
    runUrl: dispatchedRun.url,
    runId: dispatchedRun.databaseId,
    statusAtHandoff: dispatchedRun.status,
    stopCondition: 'successful dispatch plus recorded run URL',
  };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    console.log(
      JSON.stringify(
        await dispatchRelease({ args: parseReleaseDispatchArgs(process.argv.slice(2)) }),
        null,
        2,
      ),
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('release-dispatch.invalid-channel')) {
      console.error(releaseDispatchUsage);
    }
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}
