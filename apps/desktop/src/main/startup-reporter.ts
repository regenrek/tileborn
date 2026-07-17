import type {
  StartupStatusStore,
  StartupTaskId,
  StartupTaskStatus,
} from '../shared/startup-status.js';

export interface StartupReporter {
  readonly begin: (taskId: StartupTaskId, message?: string) => void;
  readonly complete: (taskId: StartupTaskId, message?: string) => void;
  readonly fail: (
    taskId: StartupTaskId,
    status: Extract<StartupTaskStatus, 'failed' | 'timed-out'>,
    cause: unknown,
  ) => void;
}

const formatCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
};

const getTaskLabel = (store: StartupStatusStore, taskId: StartupTaskId): string =>
  store.getSnapshot().tasks.find((task) => task.id === taskId)?.label ?? taskId;

export const createStartupReporter = (store: StartupStatusStore): StartupReporter => ({
  begin: (taskId, message) => {
    const task = store.beginTask(taskId, message);
    console.info(
      `[tileborne:start] ${task.label} started${message === undefined ? '' : `: ${message}`}`,
    );
  },
  complete: (taskId, message) => {
    const task = store.completeTask(taskId, message);
    const duration = task.durationMs === undefined ? 'unknown duration' : `${task.durationMs}ms`;
    console.info(
      `[tileborne:start] ${task.label} completed in ${duration}${
        message === undefined ? '' : `: ${message}`
      }`,
    );
  },
  fail: (taskId, status, cause) => {
    const label = getTaskLabel(store, taskId);
    const message = formatCause(cause);
    const task = store.failTask(taskId, status, message);
    const duration = task.durationMs === undefined ? 'unknown duration' : `${task.durationMs}ms`;
    console.error(`[tileborne:start] ${label} ${status} after ${duration}: ${message}`);
  },
});
