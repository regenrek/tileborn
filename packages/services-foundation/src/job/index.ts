import { randomUUID } from "node:crypto";

import { Context, Effect, Fiber, Layer, Option, Ref, Schema, Stream, SubscriptionRef } from "effect";

export const JobId = Schema.String.check(Schema.isPattern(/^job:[0-9a-f-]{36}$/)).pipe(
  Schema.brand("JobId"),
);
export type JobId = Schema.Schema.Type<typeof JobId>;

export class Pending extends Schema.TaggedClass<Pending>()("Pending", {}) {}
export class Running extends Schema.TaggedClass<Running>()("Running", {}) {}
export class Completed extends Schema.TaggedClass<Completed>()("Completed", {}) {}
export class Failed extends Schema.TaggedClass<Failed>()("Failed", {}) {}
export class Cancelled extends Schema.TaggedClass<Cancelled>()("Cancelled", {}) {}

export const JobStatus = Schema.Union([Pending, Running, Completed, Failed, Cancelled]);
export type JobStatus = Schema.Schema.Type<typeof JobStatus>;

export class JobError extends Schema.TaggedErrorClass<JobError>()("JobError", {
  message: Schema.String,
}) {}

export class JobNotFoundError extends Schema.TaggedErrorClass<JobNotFoundError>()("JobNotFoundError", {
  jobId: JobId,
  message: Schema.String,
}) {}

export interface JobState {
  readonly id: JobId;
  readonly status: JobStatus;
  readonly progress: Option.Option<number>;
  readonly result: Option.Option<unknown>;
  readonly error: Option.Option<JobError>;
}

export interface JobSpec {
  readonly name: string;
  readonly run?: Effect.Effect<unknown, unknown, never>;
}

interface JobEntry {
  readonly ref: SubscriptionRef.SubscriptionRef<JobState>;
}

export class JobService extends Context.Service<JobService, {
  readonly create: (spec: JobSpec) => Effect.Effect<JobId>;
  readonly subscribe: (jobId: JobId) => Stream.Stream<JobState, JobNotFoundError>;
  readonly list: () => Effect.Effect<readonly JobState[]>;
  readonly cancel: (jobId: JobId) => Effect.Effect<JobState, JobNotFoundError>;
}>()("@tileborne/services-foundation/JobService") {}

const makeJobId = (): JobId => `job:${randomUUID()}` as JobId;

const initialState = (id: JobId): JobState => ({
  id,
  status: new Pending({}),
  progress: Option.none(),
  result: Option.none(),
  error: Option.none(),
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
  status._tag === "Cancelled" || status._tag === "Completed" || status._tag === "Failed";

const updateJob = (
  entry: JobEntry,
  update: (state: JobState) => JobState,
): Effect.Effect<JobState> =>
  SubscriptionRef.modifySome(entry.ref, (state) => {
    if (isTerminal(state.status)) {
      return [state, Option.none()];
    }

    const next = update(state);
    return [next, Option.some(next)];
  });

export const JobServiceLive = Layer.effect(
  JobService,
  Effect.gen(function* () {
    const jobs = yield* Ref.make(new Map<JobId, JobEntry>());
    const fibers = yield* Ref.make(new Map<JobId, Fiber.Fiber<unknown, unknown>>());

    const create = Effect.fn("JobService.create")(function* (spec: JobSpec) {
      const id = makeJobId();
      const ref = yield* SubscriptionRef.make(initialState(id));
      const entry: JobEntry = { ref };
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
          .pipe(Effect.ensuring(Ref.update(fibers, (current) => {
            const next = new Map(current);
            next.delete(id);
            return next;
          })))
          .pipe(Effect.forkDetach);
        yield* Ref.update(fibers, (current) => new Map(current).set(id, fiber));
      }

      return id;
    });

    const subscribe = (jobId: JobId): Stream.Stream<JobState, JobNotFoundError> =>
      Stream.unwrap(
        getEntry(jobs, jobId).pipe(Effect.map((entry) => SubscriptionRef.changes(entry.ref))),
      );

    const list = Effect.fn("JobService.list")(function* () {
      const entries = [...(yield* Ref.get(jobs)).values()];
      return entries.map((entry) => SubscriptionRef.getUnsafe(entry.ref));
    });

    const cancel = Effect.fn("JobService.cancel")(function* (jobId: JobId) {
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

    return {
      create,
      subscribe,
      list,
      cancel,
    };
  }),
);
