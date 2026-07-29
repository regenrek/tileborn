let stopAttempts = 0;

export default {
  id: '@tileborne-plugins/renderer-owner-integration',
  onTick() {},
  onShutdown() {
    stopAttempts += 1;
    if (stopAttempts === 1) {
      throw new Error('fixture stop failed once');
    }
  },
};
