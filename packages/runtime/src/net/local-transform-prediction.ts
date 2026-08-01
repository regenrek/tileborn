export type LocalInputSequence = number;

export interface SequencedLocalTransformInput<TInput> {
  readonly sequence: LocalInputSequence;
  readonly input: TInput;
}

export type LocalTransformReducer<TTransform, TInput> = (
  transform: TTransform,
  input: TInput,
) => TTransform;

export interface LocalTransformPredictionState<TTransform, TInput> {
  readonly authoritativeTransform: TTransform;
  readonly predictedTransform: TTransform;
  readonly acknowledgedInputSequence: LocalInputSequence;
  readonly pendingInputs: readonly SequencedLocalTransformInput<TInput>[];
}

export interface LocalTransformAuthoritativeUpdate<TTransform> {
  readonly transform: TTransform;
  readonly acknowledgedInputSequence: LocalInputSequence;
}

export interface LocalTransformPredictorOptions {
  readonly maxPendingInputs?: number;
}

const DEFAULT_MAX_PENDING_INPUTS = 120;

const isValidSequence = (sequence: number): boolean =>
  Number.isSafeInteger(sequence) && sequence >= -1;

const assertValidSequence = (sequence: number, label: string): void => {
  if (!isValidSequence(sequence)) {
    throw new RangeError(`${label} must be -1 or a non-negative safe integer`);
  }
};

const normalizeMaxPendingInputs = (value: number | undefined): number => {
  if (value === undefined) {
    return DEFAULT_MAX_PENDING_INPUTS;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('maxPendingInputs must be a positive safe integer');
  }
  return value;
};

export const replayLocalTransformInputs = <TTransform, TInput>(
  authoritativeTransform: TTransform,
  pendingInputs: readonly SequencedLocalTransformInput<TInput>[],
  reducer: LocalTransformReducer<TTransform, TInput>,
): TTransform =>
  pendingInputs.reduce<TTransform>(
    (transform, entry) => reducer(transform, entry.input),
    authoritativeTransform,
  );

export class LocalTransformPredictor<TTransform, TInput> {
  readonly #reducer: LocalTransformReducer<TTransform, TInput>;
  readonly #maxPendingInputs: number;
  #authoritativeTransform: TTransform;
  #predictedTransform: TTransform;
  #acknowledgedInputSequence: LocalInputSequence;
  #pendingInputs: SequencedLocalTransformInput<TInput>[] = [];
  #nextInputSequence: LocalInputSequence;

  constructor(
    initialTransform: TTransform,
    reducer: LocalTransformReducer<TTransform, TInput>,
    options: LocalTransformPredictorOptions = {},
  ) {
    this.#reducer = reducer;
    this.#maxPendingInputs = normalizeMaxPendingInputs(options.maxPendingInputs);
    this.#authoritativeTransform = initialTransform;
    this.#predictedTransform = initialTransform;
    this.#acknowledgedInputSequence = -1;
    this.#nextInputSequence = 0;
  }

  enqueue(input: TInput, sequence?: LocalInputSequence): SequencedLocalTransformInput<TInput> {
    if (this.#pendingInputs.length >= this.#maxPendingInputs) {
      throw new RangeError(
        'local transform prediction input buffer is full; reconcile or reset before enqueueing',
      );
    }
    const inputSequence = sequence ?? this.#nextInputSequence;
    assertValidSequence(inputSequence, 'inputSequence');
    if (sequence === undefined) {
      this.#nextInputSequence += 1;
    } else {
      this.#nextInputSequence = Math.max(this.#nextInputSequence, inputSequence + 1);
    }
    const entry = { sequence: inputSequence, input };
    this.#pendingInputs.push(entry);
    this.#predictedTransform = this.#reducer(this.#predictedTransform, input);
    return entry;
  }

  upsertPending(input: TInput, sequence: LocalInputSequence): SequencedLocalTransformInput<TInput> {
    assertValidSequence(sequence, 'inputSequence');
    if (sequence <= this.#acknowledgedInputSequence) {
      throw new RangeError('pending input sequence must be newer than the acknowledged sequence');
    }
    const existingIndex = this.#pendingInputs.findIndex((entry) => entry.sequence === sequence);
    if (existingIndex < 0) {
      return this.enqueue(input, sequence);
    }
    const entry = { sequence, input };
    this.#pendingInputs[existingIndex] = entry;
    this.#predictedTransform = replayLocalTransformInputs(
      this.#authoritativeTransform,
      this.#pendingInputs,
      this.#reducer,
    );
    return entry;
  }

  /**
   * Advances the render-only prediction without creating transport history.
   * Use this for continuous simulation steps between snapshots; only inputs
   * that the authority can acknowledge belong in `enqueue`.
   */
  advance(input: TInput): TTransform {
    this.#predictedTransform = this.#reducer(this.#predictedTransform, input);
    return this.#predictedTransform;
  }

  reconcile(update: LocalTransformAuthoritativeUpdate<TTransform>): void {
    assertValidSequence(update.acknowledgedInputSequence, 'acknowledgedInputSequence');
    if (update.acknowledgedInputSequence < this.#acknowledgedInputSequence) {
      return;
    }

    this.#authoritativeTransform = update.transform;
    this.#acknowledgedInputSequence = update.acknowledgedInputSequence;
    this.#pendingInputs = this.#pendingInputs.filter(
      (entry) => entry.sequence > update.acknowledgedInputSequence,
    );
    this.#predictedTransform = replayLocalTransformInputs(
      this.#authoritativeTransform,
      this.#pendingInputs,
      this.#reducer,
    );
  }

  reset(transform: TTransform): void {
    this.#authoritativeTransform = transform;
    this.#predictedTransform = transform;
    this.#acknowledgedInputSequence = -1;
    this.#pendingInputs = [];
    this.#nextInputSequence = 0;
  }

  getState(): LocalTransformPredictionState<TTransform, TInput> {
    return {
      authoritativeTransform: this.#authoritativeTransform,
      predictedTransform: this.#predictedTransform,
      acknowledgedInputSequence: this.#acknowledgedInputSequence,
      pendingInputs: [...this.#pendingInputs],
    };
  }
}
