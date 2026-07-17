import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  Context,
  Effect,
  Fiber,
  Layer,
  Option,
  Ref,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from 'effect';

import { HomeService } from '../home/index.js';
import { writeJsonAtomic } from '../internal/atomic-json.js';

export const JobId = Schema.String.check(Schema.isPattern(/^job:[0-9a-f-]{36}$/)).pipe(
  Schema.brand('JobId'),
);
export type JobId = Schema.Schema.Type<typeof JobId>;

export class Pending extends Schema.TaggedClass<Pending>()('Pending', {}) {}
export class Running extends Schema.TaggedClass<Running>()('Running', {}) {}
export class Completed extends Schema.TaggedClass<Completed>()('Completed', {}) {}
export class Failed extends Schema.TaggedClass<Failed>()('Failed', {}) {}
export class Cancelled extends Schema.TaggedClass<Cancelled>()('Cancelled', {}) {}

export const JobStatus = Schema.Union([Pending, Running, Completed, Failed, Cancelled]);
export type JobStatus = Schema.Schema.Type<typeof JobStatus>;

export class JobError extends Schema.TaggedErrorClass<JobError>()('JobError', {
  message: Schema.String,
}) {}

export class JobNotFoundError extends Schema.TaggedErrorClass<JobNotFoundError>()(
  'JobNotFoundError',
  {
    jobId: JobId,
    message: Schema.String,
  },
) {}

export interface JobState {
  readonly id: JobId;
  readonly status: JobStatus;
  readonly progress: Option.Option<number>;
  readonly result: Option.Option<unknown>;
  readonly error: Option.Option<JobError>;
  readonly logs: readonly string[];
}

export interface JobSpec {
  readonly name: string;
  readonly run?: Effect.Effect<unknown, unknown, never>;
}

interface JobEntry {
  readonly ref: SubscriptionRef.SubscriptionRef<JobState>;
  readonly updateGate: Semaphore.Semaphore;
}

export class JobService extends Context.Service<
  JobService,
  {
    readonly create: (spec: JobSpec) => Effect.Effect<JobId>;
    readonly subscribe: (jobId: JobId) => Stream.Stream<JobState, JobNotFoundError>;
    readonly list: () => Effect.Effect<readonly JobState[]>;
    readonly cancel: (jobId: JobId) => Effect.Effect<JobState, JobNotFoundError>;
    readonly report: (
      jobId: JobId,
      update: { readonly progress?: number; readonly message?: string },
    ) => Effect.Effect<JobState, JobNotFoundError>;
  }
>()('@tileborne/services-foundation/JobService') {}

const makeJobId = (): JobId => `job:${randomUUID()}` as JobId;

const initialState = (id: JobId): JobState => ({
  id,
  status: new Pending({}),
  progress: Option.none(),
  result: Option.none(),
  error: Option.none(),
  logs: [],
});

const notFound = (jobId: JobId): JobNotFoundError =>
  new JobNotFoundError({ jobId, message: `job not found: ${jobId}` });

const getEntry = (
  jobs: Ref.Ref<Map<JobId, JobEntry>>,
  jobId: JobId,
): Effect.Effect<JobEntry, JobNotFoundError> =>
  Effect.gen(function* () {
    const entry = (yield* Ref.get(jobs)).get(jobId);
    if (!entry) {
      yield* notFound(jobId);
    }
    return entry as JobEntry;
  });

const isTerminal = (status: JobStatus): boolean =>
  status._tag === 'Cancelled' || status._tag === 'Completed' || status._tag === 'Failed';

const updateJob = (
  entry: JobEntry,
  update: (state: JobState) => JobState,
  persist?: (state: JobState) => Effect.Effect<void>,
): Effect.Effect<JobState> =>
  entry.updateGate.withPermit(
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.get(entry.ref);
      if (isTerminal(state.status)) return state;

      const next = update(state);
      yield* persist?.(next) ?? Effect.void;
      yield* SubscriptionRef.set(entry.ref, next);
      return next;
    }),
  );

export const JobServiceLive = Layer.effect(
  JobService,
  Effect.gen(function* () {
    const jobs = yield* Ref.make(new Map<JobId, JobEntry>());
    const fibers = yield* Ref.make(new Map<JobId, Fiber.Fiber<unknown, unknown>>());

    const create = Effect.fn('JobService.create')(function* (spec: JobSpec) {
      const id = makeJobId();
      const ref = yield* SubscriptionRef.make(initialState(id));
      const updateGate = yield* Semaphore.make(1);
      const entry: JobEntry = { ref, updateGate };
      yield* Ref.update(jobs, (current) => new Map(current).set(id, entry));

      const run = spec.run;
      if (run) {
        const fiber = yield* Effect.gen(function* () {
          yield* updateJob(entry, (state) => ({
            ...state,
            status: new Running({}),
            progress: Option.some(0),
          }));
          yield* Effect.matchEffect(run, {
            onFailure: (cause) =>
              updateJob(entry, (state) => ({
                ...state,
                status: new Failed({}),
                progress: Option.none(),
                error: Option.some(
                  new JobError({ message: cause instanceof Error ? cause.message : String(cause) }),
                ),
              })),
            onSuccess: (result) =>
              updateJob(entry, (state) => ({
                ...state,
                status: new Completed({}),
                progress: Option.some(1),
                result: Option.some(result),
              })),
          });
        })
          .pipe(
            Effect.ensuring(
              Ref.update(fibers, (current) => {
                const next = new Map(current);
                next.delete(id);
                return next;
              }),
            ),
          )
          .pipe(Effect.forkDetach);
        yield* Ref.update(fibers, (current) => new Map(current).set(id, fiber));
      }

      return id;
    });

    const subscribe = (jobId: JobId): Stream.Stream<JobState, JobNotFoundError> =>
      Stream.unwrap(
        getEntry(jobs, jobId).pipe(Effect.map((entry) => SubscriptionRef.changes(entry.ref))),
      );

    const list = Effect.fn('JobService.list')(function* () {
      const entries = [...(yield* Ref.get(jobs)).values()];
      return entries.map((entry) => SubscriptionRef.getUnsafe(entry.ref));
    });

    const cancel = Effect.fn('JobService.cancel')(function* (jobId: JobId) {
      const entry = yield* getEntry(jobs, jobId);
      const fiber = (yield* Ref.get(fibers)).get(jobId);
      if (fiber) {
        yield* Fiber.interrupt(fiber);
      }
      return yield* updateJob(entry, (state) => ({
        ...state,
        status: new Cancelled({}),
        progress: Option.none(),
      }));
    });

    const report = Effect.fn('JobService.report')(function* (
      jobId: JobId,
      update: { readonly progress?: number; readonly message?: string },
    ) {
      const entry = yield* getEntry(jobs, jobId);
      return yield* updateJob(entry, (state) => ({
        ...state,
        ...(update.progress === undefined
          ? {}
          : { progress: Option.some(Math.max(0, Math.min(1, update.progress))) }),
        ...(update.message === undefined ? {} : { logs: [...state.logs, update.message] }),
      }));
    });

    return {
      create,
      subscribe,
      list,
      cancel,
      report,
    };
  }),
);

interface PersistedJobState {
  readonly id: string;
  readonly status: JobStatus['_tag'];
  readonly progress?: number;
  readonly hasResult: boolean;
  readonly result?: unknown;
  readonly error?: string;
  readonly logs: readonly string[];
  readonly createdAt: string;
}

const statusFromTag = (tag: PersistedJobState['status']): JobStatus => {
  switch (tag) {
    case 'Pending':
      return new Pending({});
    case 'Running':
      return new Running({});
    case 'Completed':
      return new Completed({});
    case 'Failed':
      return new Failed({});
    case 'Cancelled':
      return new Cancelled({});
  }
};

const encodePersistedState = (state: JobState, createdAt: string): PersistedJobState => ({
  id: state.id,
  status: state.status._tag,
  ...(Option.isSome(state.progress) ? { progress: state.progress.value } : {}),
  hasResult: Option.isSome(state.result),
  ...(Option.isSome(state.result) ? { result: state.result.value } : {}),
  ...(Option.isSome(state.error) ? { error: state.error.value.message } : {}),
  logs: state.logs,
  createdAt,
});

const decodePersistedState = (
  value: unknown,
): { readonly state: JobState; readonly createdAt: string } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('persisted job must be an object');
  }
  const raw = value as Partial<PersistedJobState>;
  const id = Schema.decodeUnknownSync(JobId)(raw.id);
  const tag = raw.status;
  if (!['Pending', 'Running', 'Completed', 'Failed', 'Cancelled'].includes(String(tag))) {
    throw new Error(`invalid persisted job status: ${String(tag)}`);
  }
  const logs =
    Array.isArray(raw.logs) && raw.logs.every((entry) => typeof entry === 'string') ? raw.logs : [];
  const interrupted = tag === 'Pending' || tag === 'Running';
  return {
    state: {
      id,
      status: interrupted ? new Cancelled({}) : statusFromTag(tag as PersistedJobState['status']),
      progress:
        typeof raw.progress === 'number' && !interrupted
          ? Option.some(raw.progress)
          : Option.none(),
      result: raw.hasResult === true && !interrupted ? Option.some(raw.result) : Option.none(),
      error:
        typeof raw.error === 'string' && !interrupted
          ? Option.some(new JobError({ message: raw.error }))
          : Option.none(),
      logs: interrupted ? [...logs, 'Cancelled because the app restarted.'] : logs,
    },
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '1970-01-01T00:00:00.000Z',
  };
};

/**
 * Durable desktop job owner. Terminal results/logs survive restart; work that
 * was in-flight is recovered as Cancelled because detached fibers cannot be
 * resumed safely in a new process.
 */
export const JobServicePersistentLive = Layer.effect(
  JobService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const jobsDirectory = path.join(home.paths.cache, 'jobs');
    yield* Effect.tryPromise({
      try: () => mkdir(jobsDirectory, { recursive: true }),
      catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
    });

    const loaded = yield* Effect.tryPromise({
      try: async () => {
        const entries = await readdir(jobsDirectory, { withFileTypes: true });
        const values: { readonly state: JobState; readonly createdAt: string }[] = [];
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
          try {
            values.push(
              decodePersistedState(
                JSON.parse(await readFile(path.join(jobsDirectory, entry.name), 'utf8')),
              ),
            );
          } catch {
            // A corrupt single job record must not prevent the editor booting.
          }
        }
        return values.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      },
      catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
    });

    const jobs = yield* Ref.make(new Map<JobId, JobEntry>());
    const fibers = yield* Ref.make(new Map<JobId, Fiber.Fiber<unknown, unknown>>());
    const createdAt = new Map<JobId, string>();
    const persist = (state: JobState): Effect.Effect<void> => {
      const timestamp = createdAt.get(state.id) ?? new Date().toISOString();
      createdAt.set(state.id, timestamp);
      return writeJsonAtomic(
        path.join(jobsDirectory, `${state.id.replace(':', '-')}.json`),
        encodePersistedState(state, timestamp),
      ).pipe(Effect.orDie);
    };

    for (const recovered of loaded) {
      createdAt.set(recovered.state.id, recovered.createdAt);
      const ref = yield* SubscriptionRef.make(recovered.state);
      const updateGate = yield* Semaphore.make(1);
      yield* Ref.update(jobs, (current) =>
        new Map(current).set(recovered.state.id, { ref, updateGate }),
      );
      yield* persist(recovered.state);
    }

    const create = Effect.fn('JobService.createPersistent')(function* (spec: JobSpec) {
      const id = makeJobId();
      createdAt.set(id, new Date().toISOString());
      const ref = yield* SubscriptionRef.make(initialState(id));
      const updateGate = yield* Semaphore.make(1);
      const entry: JobEntry = { ref, updateGate };
      yield* Ref.update(jobs, (current) => new Map(current).set(id, entry));
      yield* persist(SubscriptionRef.getUnsafe(ref));

      if (spec.run) {
        const run = spec.run;
        const fiber = yield* Effect.gen(function* () {
          yield* updateJob(
            entry,
            (state) => ({ ...state, status: new Running({}), progress: Option.some(0) }),
            persist,
          );
          yield* Effect.matchEffect(run, {
            onFailure: (cause) =>
              updateJob(
                entry,
                (state) => ({
                  ...state,
                  status: new Failed({}),
                  progress: Option.none(),
                  error: Option.some(
                    new JobError({
                      message: cause instanceof Error ? cause.message : String(cause),
                    }),
                  ),
                }),
                persist,
              ),
            onSuccess: (result) =>
              updateJob(
                entry,
                (state) => ({
                  ...state,
                  status: new Completed({}),
                  progress: Option.some(1),
                  result: Option.some(result),
                }),
                persist,
              ),
          });
        }).pipe(
          Effect.ensuring(
            Ref.update(fibers, (current) => {
              const next = new Map(current);
              next.delete(id);
              return next;
            }),
          ),
          Effect.forkDetach,
        );
        yield* Ref.update(fibers, (current) => new Map(current).set(id, fiber));
      }
      return id;
    });

    const subscribe = (jobId: JobId): Stream.Stream<JobState, JobNotFoundError> =>
      Stream.unwrap(
        getEntry(jobs, jobId).pipe(Effect.map((entry) => SubscriptionRef.changes(entry.ref))),
      );
    const list = Effect.fn('JobService.listPersistent')(function* () {
      return [...(yield* Ref.get(jobs)).values()].map((entry) =>
        SubscriptionRef.getUnsafe(entry.ref),
      );
    });
    const cancel = Effect.fn('JobService.cancelPersistent')(function* (jobId: JobId) {
      const entry = yield* getEntry(jobs, jobId);
      const fiber = (yield* Ref.get(fibers)).get(jobId);
      if (fiber) yield* Fiber.interrupt(fiber);
      return yield* updateJob(
        entry,
        (state) => ({
          ...state,
          status: new Cancelled({}),
          progress: Option.none(),
        }),
        persist,
      );
    });
    const report = Effect.fn('JobService.reportPersistent')(function* (
      jobId: JobId,
      update: { readonly progress?: number; readonly message?: string },
    ) {
      const entry = yield* getEntry(jobs, jobId);
      return yield* updateJob(
        entry,
        (state) => ({
          ...state,
          ...(update.progress === undefined
            ? {}
            : { progress: Option.some(Math.max(0, Math.min(1, update.progress))) }),
          ...(update.message === undefined ? {} : { logs: [...state.logs, update.message] }),
        }),
        persist,
      );
    });

    return { create, subscribe, list, cancel, report };
  }),
);
