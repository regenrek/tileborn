import { Effect } from 'effect';

import { MainIpcRegistry, handlerBuilder, type IpcHandlerGroupOf } from '@tileborne/ipc-contracts';

import { ipcCatchAll } from './errors.js';
import { createDesktopUpdaterController, type DesktopUpdaterController } from '../updater.js';

type DesktopUpdateChannel =
  | 'tileborne:desktop-updates:getState'
  | 'tileborne:desktop-updates:check'
  | 'tileborne:desktop-updates:restart';

export const createDesktopUpdateHandlers = (
  updater: DesktopUpdaterController = createDesktopUpdaterController(),
): IpcHandlerGroupOf<typeof MainIpcRegistry, DesktopUpdateChannel> =>
  handlerBuilder(MainIpcRegistry)
    .add('tileborne:desktop-updates:getState', () => Effect.sync(() => updater.getState()))
    .add('tileborne:desktop-updates:check', () =>
      ipcCatchAll('tileborne:desktop-updates:check')(Effect.sync(() => updater.checkForUpdates())),
    )
    .add('tileborne:desktop-updates:restart', () =>
      ipcCatchAll('tileborne:desktop-updates:restart')(
        Effect.sync(() => updater.restartToApplyUpdate()),
      ),
    )
    .build();
