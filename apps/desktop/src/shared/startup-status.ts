export const STARTUP_STATUS_GET_CHANNEL = "tileborne:startup:getStatus";
export const STARTUP_STATUS_CHANGED_CHANNEL = "tileborne:startup:changed";

export const STARTUP_TASK_DEFINITIONS = [
  { id: "app-ready", label: "Electron app ready", required: true },
  { id: "create-load-window", label: "Create and load main window", required: true },
  { id: "background-startup", label: "Background startup", required: true },
  { id: "runtime-services", label: "Effect runtime boundary", required: true },
  { id: "home-init", label: "Home directory initialization", required: true },
  { id: "ipc-registration", label: "Domain IPC registration", required: true },
  { id: "plugin-seed", label: "Battle Royale plugin seed", required: false },
] as const;

export type StartupTaskId = (typeof STARTUP_TASK_DEFINITIONS)[number]["id"];
export type StartupTaskStatus = "pending" | "running" | "completed" | "failed" | "timed-out";
export type StartupState = "starting" | "ready" | "degraded" | "failed";

export interface StartupTaskSnapshot {
  readonly id: StartupTaskId;
  readonly label: string;
  readonly required: boolean;
  readonly status: StartupTaskStatus;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly message?: string;
}

export interface StartupErrorSnapshot {
  readonly taskId: StartupTaskId;
  readonly label: string;
  readonly status: "failed" | "timed-out";
  readonly message: string;
  readonly at: string;
}

export interface StartupStatusSnapshot {
  readonly state: StartupState;
  readonly tasks: readonly StartupTaskSnapshot[];
  readonly errors: readonly StartupErrorSnapshot[];
  readonly updatedAt: string;
  readonly currentTaskId?: StartupTaskId;
}

export interface TileborneStartupBridge {
  readonly getStatus: () => Promise<StartupStatusSnapshot>;
  readonly onStatusChanged: (handler: (snapshot: StartupStatusSnapshot) => void) => () => void;
}

export interface StartupStatusStore {
  readonly getSnapshot: () => StartupStatusSnapshot;
  readonly subscribe: (handler: (snapshot: StartupStatusSnapshot) => void) => () => void;
  readonly beginTask: (taskId: StartupTaskId, message?: string) => StartupTaskSnapshot;
  readonly completeTask: (taskId: StartupTaskId, message?: string) => StartupTaskSnapshot;
  readonly failTask: (
    taskId: StartupTaskId,
    status: "failed" | "timed-out",
    message: string,
  ) => StartupTaskSnapshot;
  readonly setState: (state: StartupState) => StartupStatusSnapshot;
}

export interface StartupStatusStoreOptions {
  readonly now?: () => Date;
}

const taskDefinitionById = new Map<StartupTaskId, (typeof STARTUP_TASK_DEFINITIONS)[number]>(
  STARTUP_TASK_DEFINITIONS.map((definition) => [definition.id, definition]),
);

const pendingTask = (taskId: StartupTaskId): StartupTaskSnapshot => {
  const definition = taskDefinitionById.get(taskId);
  if (definition === undefined) {
    throw new Error(`Unknown startup task: ${taskId}`);
  }
  return {
    id: definition.id,
    label: definition.label,
    required: definition.required,
    status: "pending",
  };
};

const durationSince = (startedAt: string | undefined, completedAt: string): number | undefined => {
  if (startedAt === undefined) {
    return undefined;
  }
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
};

const withMessage = <Task extends StartupTaskSnapshot>(
  task: Task,
  message: string | undefined,
): StartupTaskSnapshot => (message === undefined ? task : { ...task, message });

export const isStartupTaskRequired = (taskId: StartupTaskId): boolean => {
  const definition = taskDefinitionById.get(taskId);
  if (definition === undefined) {
    throw new Error(`Unknown startup task: ${taskId}`);
  }
  return definition.required;
};

export const createStartupStatusStore = (
  options: StartupStatusStoreOptions = {},
): StartupStatusStore => {
  const now = options.now ?? (() => new Date());
  const tasks = new Map<StartupTaskId, StartupTaskSnapshot>();
  const errors: StartupErrorSnapshot[] = [];
  const subscribers = new Set<(snapshot: StartupStatusSnapshot) => void>();
  let state: StartupState = "starting";
  let currentTaskId: StartupTaskId | undefined;
  let updatedAt = now().toISOString();

  const getTask = (taskId: StartupTaskId): StartupTaskSnapshot => tasks.get(taskId) ?? pendingTask(taskId);

  const getSnapshot = (): StartupStatusSnapshot => {
    const snapshot = {
      state,
      tasks: STARTUP_TASK_DEFINITIONS.map((definition) => getTask(definition.id)),
      errors: [...errors],
      updatedAt,
      ...(currentTaskId === undefined ? {} : { currentTaskId }),
    };
    return snapshot;
  };

  const publish = (): StartupStatusSnapshot => {
    updatedAt = now().toISOString();
    const snapshot = getSnapshot();
    for (const subscriber of subscribers) {
      subscriber(snapshot);
    }
    return snapshot;
  };

  const updateCurrentTask = (taskId: StartupTaskId): void => {
    if (currentTaskId !== taskId) {
      return;
    }
    currentTaskId = STARTUP_TASK_DEFINITIONS.map((definition) => getTask(definition.id)).find(
      (task) => task.status === "running",
    )?.id;
  };

  return {
    getSnapshot,
    subscribe: (handler) => {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },
    beginTask: (taskId, message) => {
      const startedAt = now().toISOString();
      const next = withMessage(
        {
          ...pendingTask(taskId),
          status: "running",
          startedAt,
        },
        message,
      );
      tasks.set(taskId, next);
      currentTaskId = taskId;
      publish();
      return next;
    },
    completeTask: (taskId, message) => {
      const completedAt = now().toISOString();
      const previous = getTask(taskId);
      const durationMs = durationSince(previous.startedAt, completedAt);
      const next = withMessage(
        {
          ...previous,
          status: "completed",
          completedAt,
          ...(durationMs === undefined ? {} : { durationMs }),
        },
        message,
      );
      tasks.set(taskId, next);
      updateCurrentTask(taskId);
      publish();
      return next;
    },
    failTask: (taskId, status, message) => {
      const completedAt = now().toISOString();
      const previous = getTask(taskId);
      const durationMs = durationSince(previous.startedAt, completedAt);
      const next = {
        ...previous,
        status,
        completedAt,
        ...(durationMs === undefined ? {} : { durationMs }),
        message,
      };
      tasks.set(taskId, next);
      errors.push({
        taskId,
        label: previous.label,
        status,
        message,
        at: completedAt,
      });
      if (previous.required) {
        state = "failed";
      } else if (state !== "failed") {
        state = "degraded";
      }
      updateCurrentTask(taskId);
      publish();
      return next;
    },
    setState: (nextState) => {
      state = nextState;
      return publish();
    },
  };
};
