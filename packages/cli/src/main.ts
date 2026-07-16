#!/usr/bin/env node
import { defineCommand, defineCittyPlugin, runMain } from 'citty';

import { assetCommand } from './commands/asset/index.js';
import { devCommand } from './commands/dev/index.js';
import { gameCommand } from './commands/game/index.js';
import { logsCommand } from './commands/logs/index.js';
import { mapCommand } from './commands/map/index.js';
import { playtestCommand } from './commands/playtest/index.js';
import { pluginCommand } from './commands/plugin/index.js';
import { configCommand, doctorCommand, homeCommand } from './commands/system/index.js';
import { projectCommand } from './commands/project/index.js';
import { runtimeCommand } from './commands/runtime/index.js';
import { supportCommand } from './commands/support/index.js';
import { testCommand } from './commands/test/index.js';
import { tiledCommand } from './commands/tiled/index.js';
import { applyLogLevelEnv } from './render/output.js';
import { PACKAGE_VERSION } from './commands/shared.js';
import { cancelActiveCliWork, disposeCliRuntime } from './services-layer.js';
import { runSignalCleanups, signalExitCodeOr } from './lib/shutdown.js';

const shutdownPlugin = defineCittyPlugin({
  name: 'shutdown',
  cleanup() {
    cancelActiveCliWork();
  },
});

const main = defineCommand({
  meta: {
    name: 'tileborne',
    version: PACKAGE_VERSION,
    description: 'Tileborne platform CLI',
  },
  plugins: [shutdownPlugin],
  setup() {
    applyLogLevelEnv();
    const onSignal = (): void => {
      cancelActiveCliWork();
      void runSignalCleanups()
        .then(() => disposeCliRuntime())
        .finally(() => process.exit(signalExitCodeOr(130)));
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  },
  cleanup() {
    void disposeCliRuntime();
  },
  subCommands: {
    doctor: defineCommand(doctorCommand),
    home: defineCommand(homeCommand),
    config: defineCommand(configCommand),
    project: defineCommand(projectCommand),
    plugin: defineCommand(pluginCommand),
    asset: defineCommand(assetCommand),
    map: defineCommand(mapCommand),
    playtest: defineCommand(playtestCommand),
    runtime: defineCommand(runtimeCommand),
    game: defineCommand(gameCommand),
    dev: defineCommand(devCommand),
    test: defineCommand(testCommand),
    tiled: defineCommand(tiledCommand),
    logs: defineCommand(logsCommand),
    support: defineCommand(supportCommand),
  },
});

runMain(main);
