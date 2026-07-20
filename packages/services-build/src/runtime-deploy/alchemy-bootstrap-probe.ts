import * as Alchemy from 'alchemy';
import * as Output from 'alchemy/Output';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

const stack = Alchemy.Stack(
  'tileborne-bootstrap-probe',
  {
    providers: Layer.empty,
    state: Alchemy.localState(),
  },
  Effect.sync(() => {
    const endpoint = Output.asOutput('https://bootstrap.invalid');
    return Output.map(
      endpoint,
      (resolvedEndpoint) =>
        `TILEBORNE_ALCHEMY_RESULT_JSON=${JSON.stringify({
          endpoint: resolvedEndpoint,
          status: 'deployed',
          logs: ['alchemy official output bootstrap ok'],
        })}`,
    );
  }),
);

export default stack;
