import { describe, expect, it } from 'vitest';

import { dispatchRelease, parseReleaseDispatchArgs } from './release-dispatch.mjs';

const sourceSha = 'a'.repeat(40);
const workflowHeadSha = 'b'.repeat(40);

type Run = {
  readonly databaseId: number;
  readonly url: string;
  readonly headSha: string;
  readonly status: string;
  readonly conclusion: string;
  readonly createdAt: string;
};

const run = (databaseId: number, headSha = workflowHeadSha): Run => ({
  databaseId,
  url: `https://github.com/regenrek/tileborn/actions/runs/${databaseId}`,
  headSha,
  status: 'queued',
  conclusion: '',
  createdAt: `2026-07-27T17:${databaseId % 60}:00Z`,
});

const mockedGh = ({ lists }: { readonly lists: readonly (readonly Run[])[] }) => {
  const commands: readonly string[][][] = [];
  let listIndex = 0;
  const commandRunner = (command: string, args: readonly string[]) => {
    (commands as string[][][]).push([[command], [...args]]);
    if (command === 'gh' && args[0] === 'run' && args[1] === 'list') {
      const response = lists[Math.min(listIndex, lists.length - 1)] ?? [];
      listIndex += 1;
      return JSON.stringify(response);
    }
    if (command === 'gh' && args[0] === 'workflow' && args[1] === 'run') return '';
    if (command === 'git') return workflowHeadSha;
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  };
  return { commands, commandRunner };
};

describe('release dispatch wrapper', () => {
  it('ignores older same-head runs and records the newly registered run URL', async () => {
    const older = run(100, sourceSha);
    const newer = run(101, sourceSha);
    const { commandRunner } = mockedGh({ lists: [[older], [newer, older]] });

    const receipt = await dispatchRelease({
      args: { channel: 'advisory', sha: sourceSha },
      commandRunner,
      sleep: async () => {},
      registrationDelayMs: 0,
    });

    expect(receipt).toMatchObject({
      channel: 'advisory',
      sourceSha,
      workflowHeadSha: sourceSha,
      runUrl: newer.url,
      runId: 101,
      stopCondition: 'successful dispatch plus recorded run URL',
    });
  });

  it('bounded-retries until a new run registers without polling completion', async () => {
    const older = run(200);
    const newer = run(201);
    const { commandRunner, commands } = mockedGh({ lists: [[older], [older], [newer, older]] });

    const receipt = await dispatchRelease({
      args: { channel: 'advisory', sha: sourceSha },
      commandRunner,
      sleep: async () => {},
      registrationDelayMs: 0,
    });

    expect(receipt.runId).toBe(201);
    expect(commands.flat().flat().join(' ')).not.toContain('gh run view');
  });

  it('does not require fast source_sha to equal the workflow ref headSha', async () => {
    const older = run(300, workflowHeadSha);
    const newer = run(301, workflowHeadSha);
    const { commandRunner, commands } = mockedGh({ lists: [[older], [newer, older]] });

    const receipt = await dispatchRelease({
      args: { channel: 'fast', sha: sourceSha, version: '0.0.1', publish: '0' },
      commandRunner,
      sleep: async () => {},
      registrationDelayMs: 0,
    });

    expect(receipt).toMatchObject({
      channel: 'fast',
      sourceSha,
      workflowHeadSha,
      version: '0.0.1',
      publishRequested: false,
      runUrl: newer.url,
    });
    expect(commands.flat().flat().join(' ')).toContain(`source_sha=${sourceSha}`);
  });

  it('parses pnpm script separator without creating an empty option', () => {
    expect(parseReleaseDispatchArgs(['--', '--channel', 'stable', '--publish', '0'])).toEqual({
      channel: 'stable',
      publish: '0',
    });
  });
});
