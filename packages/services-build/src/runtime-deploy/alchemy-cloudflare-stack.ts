import * as Alchemy from 'alchemy';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Output from 'alchemy/Output';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';

import type { RuntimeDeployOperation } from '../model.js';

interface AlchemyCloudflareStackInput {
  readonly operation: RuntimeDeployOperation;
  readonly workerName: string;
  readonly stage: string;
  readonly workerPath: string;
  readonly behaviorWorkerPath: string;
}

const ALCHEMY_RESULT_PREFIX = 'TILEBORNE_ALCHEMY_RESULT_JSON=';

const input = JSON.parse(requireEnv('TILEBORNE_ALCHEMY_INPUT')) as AlchemyCloudflareStackInput;
const handoffSigningKey = requireEnv('TILEBORNE_HANDOFF_SIGNING_KEY');

const stack = Alchemy.Stack(
  'tileborne-game-host',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const behaviorWorker = yield* Cloudflare.Worker('behavior-runtime', {
      name: `${input.workerName}-behaviors`,
      main: input.behaviorWorkerPath,
      compatibility: { date: '2024-12-01' },
    });

    const playtestRoom = Cloudflare.DurableObjectNamespace('playtest-room', {
      className: 'PlaytestRoom',
    });

    const gameHostWorker = yield* Cloudflare.Worker('game-host', {
      name: input.workerName,
      main: input.workerPath,
      url: true,
      compatibility: { date: '2024-12-01' },
      exports: ['PlaytestRoom'],
      env: {
        PLAYTEST_ROOM: playtestRoom,
        BEHAVIOR_RUNTIME: behaviorWorker,
        HANDOFF_SIGNING_KEY: Redacted.make(handoffSigningKey),
        ROOM_IDLE_TIMEOUT_SECONDS: process.env.ROOM_IDLE_TIMEOUT_SECONDS ?? '60',
      },
    });

    return Output.map(
      gameHostWorker.url,
      (endpoint) =>
        `${ALCHEMY_RESULT_PREFIX}${JSON.stringify({
          endpoint: endpoint ?? '',
          status: operationStatus(input.operation),
          logs: [`alchemy-cloudflare ${input.operation} ${input.workerName}`],
          workerName: input.workerName,
          behaviorWorkerName: `${input.workerName}-behaviors`,
        })}`,
    );
  }),
);

export default stack;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function operationStatus(
  operation: RuntimeDeployOperation,
): 'planned' | 'previewed' | 'deployed' | 'running' | 'destroyed' {
  if (operation === 'plan') return 'planned';
  if (operation === 'preview') return 'previewed';
  if (operation === 'destroy') return 'destroyed';
  if (operation === 'deploy') return 'deployed';
  return 'running';
}
