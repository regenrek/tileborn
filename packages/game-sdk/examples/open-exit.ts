import { defineBehavior, refs } from '@tileborne/game-sdk';

export default defineBehavior({
  id: 'example.open-exit',
  state: { opened: false },
  refs: { exit: refs.entity<'door'>('object:exit') },
  requiredCapabilities: ['state.core', 'time.deterministic'],
  on: {
    'lifecycle.started': ({ state, timers }) => [
      state.set('opened', true),
      timers.after(60, 'announce-open'),
    ],
  },
});
