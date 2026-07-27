#!/usr/bin/env node

/* global console, process */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const usage =
  'Usage: node scripts/release-dispatch.mjs --channel fast|stable|advisory [--sha <40-hex>] [--version <semver>] [--publish 0|1]';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((value, index, all) => {
    if (!value.startsWith('--')) return [];
    return [[value.slice(2), all[index + 1]]];
  }),
);

const run = (command, commandArgs) =>
  execFileSync(command, commandArgs, {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const channel = args.channel;
if (!['fast', 'stable', 'advisory'].includes(channel)) {
  console.error(usage);
  process.exit(2);
}

const repo = path.resolve(import.meta.dirname, '..');
const sourceSha = args.sha ?? run('git', ['rev-parse', 'HEAD']);
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
if (channel === 'fast') {
  run('gh', [
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
  ]);
} else if (channel === 'stable') {
  run('gh', [
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
  ]);
} else {
  run('gh', ['workflow', 'run', 'release-advisory.yml', '--ref', 'main']);
}

const workflow = `release-${channel}.yml`;
const runList = JSON.parse(
  run('gh', [
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
    '10',
  ]),
);
const dispatchedRun =
  channel === 'advisory'
    ? runList[0]
    : runList.find((candidate) => candidate.headSha === sourceSha);
if (dispatchedRun === undefined) {
  throw new Error(`release-dispatch.run-not-found: ${workflow} ${sourceSha}`);
}

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      channel,
      workflow,
      sourceSha,
      version: channel === 'advisory' ? null : version,
      publishRequested: publish,
      runUrl: dispatchedRun.url,
      runId: dispatchedRun.databaseId,
      statusAtHandoff: dispatchedRun.status,
      stopCondition: 'successful dispatch plus recorded run URL',
    },
    null,
    2,
  ),
);
