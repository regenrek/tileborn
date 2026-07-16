import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { Deferred, Effect, Fiber, Layer, Option, Stream } from 'effect';

import { HomeServiceLive } from '../home/index.js';
import { JobId, JobService, JobServiceLive, JobServicePersistentLive } from './index.js';

describe('JobService', () => {
  it('creates a pending job and lists it', async () => {
    const states = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* JobService;
        const id = yield* service.create({ name: 'pending' });
        const list = yield* service.list();
        return { id, list };
      }).pipe(Effect.provide(JobServiceLive)),
    );

    expect(states.list).toHaveLength(1);
    expect(states.list[0]?.id).toBe(states.id);
    expect(states.list[0]?.status._tag).toBe('Pending');
  });

  it('streams running and completed job transitions', async () => {
    const statuses = await Effect.runPromise(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>();
        const service = yield* JobService;
        const id = yield* service.create({
          name: 'complete',
          run: Deferred.await(ready).pipe(Effect.as('done')),
        });
        const subscribed = yield* Deferred.make<void>();
        const fiber = yield* service.subscribe(id).pipe(
          Stream.tap(() => Deferred.succeed(subscribed, void 0)),
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(subscribed);
        yield* Deferred.succeed(ready, void 0);
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(JobServiceLive)),
    );

    expect(Array.from(statuses, (state) => state.status._tag)).toContain('Completed');
  });

  it('cancels a job and publishes Cancelled', async () => {
    const statuses = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* JobService;
        const id = yield* service.create({ name: 'cancel' });
        const subscribed = yield* Deferred.make<void>();
        const fiber = yield* service.subscribe(id).pipe(
          Stream.tap(() => Deferred.succeed(subscribed, void 0)),
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(subscribed);
        yield* service.cancel(id);
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(JobServiceLive)),
    );

    expect(Array.from(statuses, (state) => state.status._tag)).toEqual(['Pending', 'Cancelled']);
  });

  it('keeps a cancelled slow job cancelled after the run fiber is interrupted', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* JobService;
        const id = yield* service.create({
          name: 'slow-cancel',
          run: Effect.sleep('100 millis').pipe(Effect.as('too-late')),
        });
        const subscribed = yield* Deferred.make<void>();
        const fiber = yield* service.subscribe(id).pipe(
          Stream.tap(() => Deferred.succeed(subscribed, void 0)),
          Stream.takeUntil((state) => state.status._tag === 'Cancelled'),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(subscribed);
        yield* Effect.sleep('10 millis');
        yield* service.cancel(id);
        yield* Effect.sleep('150 millis');
        const list = yield* service.list();
        return {
          states: Array.from(yield* Fiber.join(fiber), (state) => state.status._tag),
          final: list.find((entry) => entry.id === id)?.status._tag,
        };
      }).pipe(Effect.provide(JobServiceLive)),
    );

    expect(result.final).toBe('Cancelled');
    expect(result.states.at(-1)).toBe('Cancelled');
    expect(result.states).not.toContain('Completed');
    expect(result.states).not.toContain('Failed');
  });

  it('does not cancel a job after it has completed', async () => {
    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* JobService;
        const id = yield* service.create({
          name: 'complete-before-cancel',
          run: Effect.succeed('done'),
        });
        yield* Effect.sleep('10 millis');
        return yield* service.cancel(id);
      }).pipe(Effect.provide(JobServiceLive)),
    );

    expect(state.status._tag).toBe('Completed');
  });

  it('records failed job errors', async () => {
    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* JobService;
        const id = yield* service.create({
          name: 'fail',
          run: Effect.fail(new Error('boom')),
        });
        yield* Effect.sleep('10 millis');
        return (yield* service.list()).find((entry) => entry.id === id);
      }).pipe(Effect.provide(JobServiceLive)),
    );

    expect(state?.status._tag).toBe('Failed');
    expect(Option.isSome(state?.error ?? Option.none())).toBe(true);
  });

  it('reports bounded progress and ordered stage logs', async () => {
    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* JobService;
        const id = yield* service.create({ name: 'reported' });
        yield* service.report(id, { progress: 0.25, message: 'Readiness passed.' });
        return yield* service.report(id, { progress: 2, message: 'Artifact verified.' });
      }).pipe(Effect.provide(JobServiceLive)),
    );

    expect(Option.getOrUndefined(state.progress)).toBe(1);
    expect(state.logs).toEqual(['Readiness passed.', 'Artifact verified.']);
  });

  it('fails subscriptions for unknown jobs', async () => {
    const missing = `job:00000000-0000-4000-8000-000000000000` as JobId;

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* JobService;
          return yield* service.subscribe(missing).pipe(Stream.runCollect);
        }).pipe(Effect.provide(JobServiceLive)),
      ),
    ).rejects.toMatchObject({ _tag: 'JobNotFoundError' });
  });

  it('persists terminal results and recovers in-flight work as Cancelled after restart', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'tileborne-jobs-'));
    const previousHome = process.env['TILEBORNE_HOME'];
    process.env['TILEBORNE_HOME'] = home;
    const persistentLayer = () => JobServicePersistentLive.pipe(Layer.provideMerge(HomeServiceLive));
    try {
      const ids = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* JobService;
          const completed = yield* service.create({
            name: 'completed',
            run: Effect.succeed({ projectId: 'project:durable', artifact: 'ready' }),
          });
          const interrupted = yield* service.create({ name: 'running', run: Effect.never });
          yield* Effect.sleep('25 millis');
          return { completed, interrupted };
        }).pipe(Effect.provide(persistentLayer())),
      );

      const restored = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* JobService;
          return yield* service.list();
        }).pipe(Effect.provide(persistentLayer())),
      );
      const completed = restored.find((job) => job.id === ids.completed);
      const interrupted = restored.find((job) => job.id === ids.interrupted);
      expect(completed?.status._tag).toBe('Completed');
      expect(Option.getOrUndefined(completed?.result ?? Option.none())).toEqual({
        projectId: 'project:durable',
        artifact: 'ready',
      });
      expect(interrupted?.status._tag).toBe('Cancelled');
      expect(interrupted?.logs.at(-1)).toBe('Cancelled because the app restarted.');
    } finally {
      if (previousHome === undefined) delete process.env['TILEBORNE_HOME'];
      else process.env['TILEBORNE_HOME'] = previousHome;
      await rm(home, { recursive: true, force: true });
    }
  });
});
