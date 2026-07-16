/**
 * REFERENCE EXAMPLE — NOT A PRODUCTION DEPLOY ENTRY
 *
 * This file documents how downstream products compose the Tileborne game-host
 * Worker + PlaytestRoom Durable Object in an Alchemy infra-as-code graph.
 * Alchemy infra-as-code graph. Copy into your consumer repo, customize names/paths,
 * and run Alchemy from there. Do not execute this file from CI or package scripts.
 */
import path from 'node:path';

import alchemy, { type Secret } from 'alchemy';
import { DurableObjectNamespace, Worker, WranglerJson } from 'alchemy/cloudflare';

/** Aligns with `PlaytestRoom` exported from the bundled worker (`className: "PlaytestRoom"`). */
type PlaytestRoomService = DurableObject;

const alchemyPassword = process.env.ALCHEMY_PASSWORD ?? process.env.PASSWORD;

const app = await alchemy(
  'tileborne-game-host',
  alchemyPassword ? { password: alchemyPassword } : {},
);

/**
 * Path to the bundled worker produced by:
 *   tileborne game build --target cloudflare --plugin <id> [--out dist/game-host-cloudflare]
 *
 * Relative to the consumer's alchemy.run.ts working directory.
 */
const gameHostWorkerScript =
  process.env.TILEBORNE_GAME_HOST_SCRIPT ?? 'dist/game-host-cloudflare/worker.js';

const playtestRoom = DurableObjectNamespace<PlaytestRoomService>('playtest-room', {
  className: 'PlaytestRoom',
  sqlite: true,
});

const handoffSigningKey = secretBinding('HANDOFF_SIGNING_KEY', {
  fallback:
    app.stage !== 'production' && app.stage !== 'staging'
      ? 'tileborne-local-handoff-signing-key-32chars-min'
      : '',
});

// Optional resources downstream products may add (uncomment and wire into bindings):
//
// import { D1Database, KVNamespace, R2Bucket, RateLimit } from "alchemy/cloudflare";
//
// const db = await D1Database("db", {
//   name: `${app.name}-${app.stage}-db`,
//   migrationsDir: "migrations",
//   adopt: true,
// });
//
// const config = await KVNamespace("config", {
//   title: `${app.name}-${app.stage}-config`,
//   adopt: true,
// });
//
// const assetPackBucket = await R2Bucket("asset-packs", {
//   name: `${app.name}-${app.stage}-asset-packs`,
//   adopt: true,
// });
//
// const connectRateLimit = RateLimit({
//   namespace_id: 1001,
//   simple: { limit: 30, period: 60 },
// });

export const gameHostWorker = await Worker('game-host', {
  name: `${app.name}-${app.stage}-game-host`,
  script: gameHostWorkerScript,
  url: true,
  compatibilityDate: '2024-12-01',
  bindings: {
    PLAYTEST_ROOM: playtestRoom,
    HANDOFF_SIGNING_KEY: handoffSigningKey,
    ROOM_IDLE_TIMEOUT_SECONDS: process.env.ROOM_IDLE_TIMEOUT_SECONDS ?? '60',
  },
});

const wranglerConfig = await WranglerJson({
  worker: gameHostWorker,
  main: gameHostWorkerScript,
  path: path.join(process.cwd(), '.alchemy', app.stage, 'wrangler.jsonc'),
});

console.log({
  stage: app.stage,
  wranglerConfigPath: wranglerConfig.path,
  workerUrl: gameHostWorker.url,
});

await app.finalize();

function secretBinding(name: string, options: { fallback?: string } = {}): string | Secret<string> {
  const value = process.env[name];
  if (!value) {
    return options.fallback ?? '';
  }
  if (alchemyPassword) {
    return alchemy.secret(value);
  }
  if (app.stage === 'production' || app.stage === 'staging') {
    throw new Error(`${name} requires ALCHEMY_PASSWORD for ${app.stage}.`);
  }
  return value;
}
