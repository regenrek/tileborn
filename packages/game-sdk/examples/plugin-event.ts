import { defineBehavior } from '@tileborne/game-sdk';

declare module '@tileborne/game-sdk' {
  interface GameEventRegistry {
    'world.player-entered-zone': { readonly playerId: string; readonly zoneId: string };
  }

  interface GameActionRegistry {
    'world.open-door': (doorId: string) => void;
  }

  interface GameCapabilityRegistry {
    'world.doors': true;
  }
}

export default defineBehavior({
  id: 'example.plugin-event',
  state: { triggered: false },
  requiredCapabilities: ['world.doors'],
  on: {
    'world.player-entered-zone': ({ event, state, actions }) => [
      state.set('triggered', event.zoneId === 'exit'),
      actions['world.open-door']('object:exit'),
    ],
  },
});
