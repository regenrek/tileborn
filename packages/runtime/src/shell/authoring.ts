import { Option, Schema } from 'effect';

export const PROJECT_GAME_SHELL_DOCUMENT_SETTINGS_KEY = 'tileborne:gameShell';
export const PROJECT_GAME_SHELL_DOCUMENT_SCHEMA_VERSION = 1;

export const GAME_SHELL_REQUIRED_SCREEN_IDS = [
  'title',
  'main-menu',
  'loading',
  'pause',
  'settings',
  'results',
] as const;

const GAME_SHELL_NAVIGATION_REQUIRED_SCREEN_IDS: ReadonlySet<GameShellRequiredScreenId> = new Set([
  'title',
  'main-menu',
  'settings',
]);

export type GameShellRequiredScreenId = (typeof GAME_SHELL_REQUIRED_SCREEN_IDS)[number];

export const GAME_SHELL_ACTION_TYPES = [
  'navigate',
  'emit-event',
  'start-single-player',
  'start-multiplayer',
  'resume',
  'open-settings',
  'retry',
  'exit',
] as const;

export type GameShellActionType = (typeof GAME_SHELL_ACTION_TYPES)[number];

export const GAME_SHELL_REGISTERED_EVENTS = [
  'shell.title.entered',
  'shell.menu.entered',
  'shell.loading.entered',
  'shell.pause.entered',
  'shell.settings.entered',
  'shell.results.entered',
  'shell.action.invoked',
  'shell.navigation.requested',
] as const;

export type GameShellRegisteredEvent = (typeof GAME_SHELL_REGISTERED_EVENTS)[number];
export type GameShellScreenKind =
  | 'title'
  | 'main-menu'
  | 'loading'
  | 'pause'
  | 'settings'
  | 'results';
export type GameShellAssetKind = 'background' | 'font';

export interface GameShellAssetRefDefinition {
  readonly assetId: string;
  readonly packId: string;
  readonly packVersion: string;
  readonly path: string;
  readonly mime: string;
  readonly kind: GameShellAssetKind;
}

export interface GameShellDesignTokensDefinition {
  readonly fontFamily: string;
  readonly textColor: string;
  readonly accentColor: string;
  readonly panelColor: string;
  readonly focusColor: string;
  readonly spacing: 'compact' | 'comfortable' | 'spacious';
  readonly motion: 'standard' | 'reduced';
}

export interface GameShellDesignTokensPatch {
  readonly fontFamily?: string | undefined;
  readonly textColor?: string | undefined;
  readonly accentColor?: string | undefined;
  readonly panelColor?: string | undefined;
  readonly focusColor?: string | undefined;
  readonly spacing?: GameShellDesignTokensDefinition['spacing'] | undefined;
  readonly motion?: GameShellDesignTokensDefinition['motion'] | undefined;
}

export interface GameShellActionDefinition {
  readonly id: string;
  readonly label: string;
  readonly type: GameShellActionType;
  readonly targetScreenId?: string | undefined;
  readonly event?: GameShellRegisteredEvent | undefined;
}

export interface GameShellScreenDefinition {
  readonly id: string;
  readonly stableId: GameShellRequiredScreenId;
  readonly version: number;
  readonly kind: GameShellScreenKind;
  readonly title: string;
  readonly subtitle: string;
  readonly enabled: boolean;
  readonly backgroundAssetId?: string | undefined;
  readonly fontAssetId?: string | undefined;
  readonly layout: 'center' | 'split' | 'stack';
  readonly actions: readonly GameShellActionDefinition[];
}

export interface GameShellAuthoringState {
  readonly pluginId: string;
  readonly screensById: Readonly<Record<string, GameShellScreenDefinition>>;
  readonly screenOrder: readonly string[];
  readonly assetsById: Readonly<Record<string, GameShellAssetRefDefinition>>;
  readonly tokens: GameShellDesignTokensDefinition;
  readonly entryScreenId: string;
}

export type GameShellAuthoringCommand =
  | { readonly type: 'apply-plugin-defaults'; readonly pluginId: string }
  | {
      readonly type: 'set-screen-text';
      readonly screenId: string;
      readonly title: string;
      readonly subtitle: string;
    }
  | {
      readonly type: 'set-screen-layout';
      readonly screenId: string;
      readonly layout: GameShellScreenDefinition['layout'];
    }
  | { readonly type: 'set-screen-enabled'; readonly screenId: string; readonly enabled: boolean }
  | { readonly type: 'set-screen-order'; readonly screenOrder: readonly string[] }
  | { readonly type: 'set-entry-screen'; readonly screenId: string }
  | { readonly type: 'set-design-tokens'; readonly tokens: GameShellDesignTokensPatch }
  | { readonly type: 'register-asset'; readonly asset: GameShellAssetRefDefinition }
  | {
      readonly type: 'set-screen-asset';
      readonly screenId: string;
      readonly slot: GameShellAssetKind;
      readonly assetId?: string | undefined;
    }
  | {
      readonly type: 'upsert-action';
      readonly screenId: string;
      readonly action: GameShellActionDefinition;
    }
  | { readonly type: 'remove-action'; readonly screenId: string; readonly actionId: string };

export interface GameShellDiagnostic {
  readonly code:
    | 'missing-required-screen'
    | 'disabled-required-screen'
    | 'unreachable-required-screen'
    | 'invalid-route'
    | 'missing-asset'
    | 'missing-font'
    | 'invalid-event';
  readonly path: string;
  readonly message: string;
}

export interface RuntimeGameShellProjection {
  readonly schemaVersion: typeof PROJECT_GAME_SHELL_DOCUMENT_SCHEMA_VERSION;
  readonly pluginId: string;
  readonly entryScreenId: string;
  readonly screens: readonly GameShellScreenDefinition[];
  readonly screenOrder: readonly string[];
  readonly assets: readonly GameShellAssetRefDefinition[];
  readonly tokens: GameShellDesignTokensDefinition;
  readonly registeredEvents: readonly GameShellRegisteredEvent[];
  readonly diagnostics: readonly GameShellDiagnostic[];
}

export interface GameShellDefaultsDefinition {
  readonly pluginId: string;
  readonly screens?: readonly GameShellScreenDefinition[] | undefined;
  readonly screenOrder?: readonly string[] | undefined;
  readonly assets?: readonly GameShellAssetRefDefinition[] | undefined;
  readonly tokens?: GameShellDesignTokensDefinition | undefined;
  readonly entryScreenId?: string | undefined;
}

export interface GameShellAssetResolution {
  readonly ok: boolean;
  readonly message?: string | undefined;
}

export interface RuntimeGameShellProjectionOptions {
  readonly resolveAsset?: (
    asset: GameShellAssetRefDefinition,
    kind: GameShellAssetKind,
  ) => GameShellAssetResolution | undefined;
}

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const ScreenId = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

export class GameShellAssetRefDocument extends Schema.Class<GameShellAssetRefDocument>(
  'GameShellAssetRefDocument',
)({
  assetId: NonEmptyString,
  packId: NonEmptyString,
  packVersion: NonEmptyString,
  path: NonEmptyString,
  mime: NonEmptyString,
  kind: Schema.Literals(['background', 'font']),
}) {}

export class GameShellDesignTokensDocument extends Schema.Class<GameShellDesignTokensDocument>(
  'GameShellDesignTokensDocument',
)({
  fontFamily: NonEmptyString,
  textColor: NonEmptyString,
  accentColor: NonEmptyString,
  panelColor: NonEmptyString,
  focusColor: NonEmptyString,
  spacing: Schema.Literals(['compact', 'comfortable', 'spacious']),
  motion: Schema.Literals(['standard', 'reduced']),
}) {}

export class GameShellActionDocument extends Schema.Class<GameShellActionDocument>(
  'GameShellActionDocument',
)({
  id: NonEmptyString,
  label: NonEmptyString,
  type: Schema.Literals(GAME_SHELL_ACTION_TYPES),
  targetScreenId: Schema.optional(ScreenId),
  event: Schema.optional(Schema.Literals(GAME_SHELL_REGISTERED_EVENTS)),
}) {}

export class GameShellScreenDocument extends Schema.Class<GameShellScreenDocument>(
  'GameShellScreenDocument',
)({
  id: ScreenId,
  stableId: Schema.Literals(GAME_SHELL_REQUIRED_SCREEN_IDS),
  version: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isInt())),
  kind: Schema.Literals(['title', 'main-menu', 'loading', 'pause', 'settings', 'results']),
  title: NonEmptyString,
  subtitle: Schema.String,
  enabled: Schema.Boolean,
  backgroundAssetId: Schema.optional(ScreenId),
  fontAssetId: Schema.optional(ScreenId),
  layout: Schema.Literals(['center', 'split', 'stack']),
  actions: Schema.Array(GameShellActionDocument),
}) {}

export class GameShellDiagnosticDocument extends Schema.Class<GameShellDiagnosticDocument>(
  'GameShellDiagnosticDocument',
)({
  code: Schema.Literals([
    'missing-required-screen',
    'disabled-required-screen',
    'unreachable-required-screen',
    'invalid-route',
    'missing-asset',
    'missing-font',
    'invalid-event',
  ]),
  path: NonEmptyString,
  message: NonEmptyString,
}) {}

export const GameShellAuthoringCommandDocument = Schema.Union([
  Schema.Struct({ type: Schema.Literal('apply-plugin-defaults'), pluginId: NonEmptyString }),
  Schema.Struct({
    type: Schema.Literal('set-screen-text'),
    screenId: ScreenId,
    title: NonEmptyString,
    subtitle: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal('set-screen-layout'),
    screenId: ScreenId,
    layout: Schema.Literals(['center', 'split', 'stack']),
  }),
  Schema.Struct({
    type: Schema.Literal('set-screen-enabled'),
    screenId: ScreenId,
    enabled: Schema.Boolean,
  }),
  Schema.Struct({ type: Schema.Literal('set-screen-order'), screenOrder: Schema.Array(ScreenId) }),
  Schema.Struct({ type: Schema.Literal('set-entry-screen'), screenId: ScreenId }),
  Schema.Struct({
    type: Schema.Literal('set-design-tokens'),
    tokens: Schema.Struct({
      fontFamily: Schema.optional(NonEmptyString),
      textColor: Schema.optional(NonEmptyString),
      accentColor: Schema.optional(NonEmptyString),
      panelColor: Schema.optional(NonEmptyString),
      focusColor: Schema.optional(NonEmptyString),
      spacing: Schema.optional(Schema.Literals(['compact', 'comfortable', 'spacious'])),
      motion: Schema.optional(Schema.Literals(['standard', 'reduced'])),
    }),
  }),
  Schema.Struct({ type: Schema.Literal('register-asset'), asset: GameShellAssetRefDocument }),
  Schema.Struct({
    type: Schema.Literal('set-screen-asset'),
    screenId: ScreenId,
    slot: Schema.Literals(['background', 'font']),
    assetId: Schema.optional(ScreenId),
  }),
  Schema.Struct({
    type: Schema.Literal('upsert-action'),
    screenId: ScreenId,
    action: GameShellActionDocument,
  }),
  Schema.Struct({ type: Schema.Literal('remove-action'), screenId: ScreenId, actionId: ScreenId }),
]);

const validateDocumentInvariants = (document: {
  readonly screens: readonly GameShellScreenDefinition[];
  readonly screenOrder: readonly string[];
  readonly assets: readonly GameShellAssetRefDefinition[];
  readonly entryScreenId: string;
}) => {
  const screenIds = new Set(document.screens.map((screen) => screen.id));
  const duplicateScreen = document.screens.find(
    (screen, index) => document.screens.findIndex((entry) => entry.id === screen.id) !== index,
  );
  if (duplicateScreen !== undefined)
    return { path: ['screens'], issue: `duplicate shell screen id: ${duplicateScreen.id}` };
  const duplicateStable = document.screens.find(
    (screen, index) =>
      document.screens.findIndex((entry) => entry.stableId === screen.stableId) !== index,
  );
  if (duplicateStable !== undefined)
    return {
      path: ['screens'],
      issue: `duplicate stable shell screen id: ${duplicateStable.stableId}`,
    };
  const missingOrdered = document.screenOrder.find((screenId) => !screenIds.has(screenId));
  if (missingOrdered !== undefined)
    return {
      path: ['screenOrder'],
      issue: `screen order references missing screen ${missingOrdered}`,
    };
  if (!screenIds.has(document.entryScreenId))
    return { path: ['entryScreenId'], issue: `entry screen is missing: ${document.entryScreenId}` };
  const duplicateAsset = document.assets.find(
    (asset, index) =>
      document.assets.findIndex((entry) => entry.assetId === asset.assetId) !== index,
  );
  if (duplicateAsset !== undefined)
    return { path: ['assets'], issue: `duplicate shell asset id: ${duplicateAsset.assetId}` };
  const assetIds = new Set(document.assets.map((asset) => asset.assetId));
  for (const screen of document.screens) {
    if (screen.backgroundAssetId !== undefined && !assetIds.has(screen.backgroundAssetId)) {
      return {
        path: ['screens', screen.id, 'backgroundAssetId'],
        issue: `screen ${screen.id} references missing background asset ${screen.backgroundAssetId}`,
      };
    }
    if (screen.fontAssetId !== undefined && !assetIds.has(screen.fontAssetId)) {
      return {
        path: ['screens', screen.id, 'fontAssetId'],
        issue: `screen ${screen.id} references missing font asset ${screen.fontAssetId}`,
      };
    }
  }
  return undefined;
};

const hasUniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const sameUniqueStringSet = (left: readonly string[], right: readonly string[]): boolean =>
  hasUniqueStrings(left) &&
  hasUniqueStrings(right) &&
  left.length === right.length &&
  left.every((value) => right.includes(value)) &&
  right.every((value) => left.includes(value));

const validateRuntimeProjectionInvariants = (projection: RuntimeGameShellProjection) => {
  const documentIssue = validateDocumentInvariants(projection);
  if (documentIssue !== undefined) return documentIssue;
  if (!sameUniqueStringSet(projection.registeredEvents, GAME_SHELL_REGISTERED_EVENTS)) {
    return {
      path: ['registeredEvents'],
      issue: 'runtime shell projection must expose exactly the registered shell events',
    };
  }
  const screenIds = projection.screens.map((screen) => screen.id);
  if (!sameUniqueStringSet(projection.screenOrder, screenIds)) {
    return {
      path: ['screenOrder'],
      issue: 'runtime shell projection screenOrder must contain every screen exactly once',
    };
  }
  for (const required of GAME_SHELL_REQUIRED_SCREEN_IDS) {
    if (!projection.screens.some((screen) => screen.stableId === required)) {
      return {
        path: ['screens'],
        issue: `runtime shell projection is missing required screen ${required}`,
      };
    }
  }
  const screenIdsById = new Set(projection.screens.map((screen) => screen.id));
  for (const screen of projection.screens) {
    for (const actionEntry of screen.actions) {
      if (actionEntry.type === 'navigate' && !screenIdsById.has(actionEntry.targetScreenId ?? '')) {
        return {
          path: ['screens', screen.id, 'actions', actionEntry.id],
          issue: 'navigate action must target an existing shell screen',
        };
      }
      if (actionEntry.type === 'emit-event' && actionEntry.event === undefined) {
        return {
          path: ['screens', screen.id, 'actions', actionEntry.id],
          issue: 'emit-event action must declare a registered shell event',
        };
      }
    }
  }
  return undefined;
};

export class ProjectGameShellDocument extends Schema.Class<ProjectGameShellDocument>(
  'ProjectGameShellDocument',
)({
  schemaVersion: Schema.Literal(PROJECT_GAME_SHELL_DOCUMENT_SCHEMA_VERSION),
  pluginId: NonEmptyString,
  projectOverrides: Schema.optional(Schema.Array(GameShellAuthoringCommandDocument)),
  screens: Schema.Array(GameShellScreenDocument),
  screenOrder: Schema.Array(ScreenId),
  assets: Schema.Array(GameShellAssetRefDocument),
  tokens: GameShellDesignTokensDocument,
  entryScreenId: ScreenId,
}) {
  static readonly validate = Schema.Struct({
    schemaVersion: Schema.Literal(PROJECT_GAME_SHELL_DOCUMENT_SCHEMA_VERSION),
    pluginId: NonEmptyString,
    projectOverrides: Schema.optional(Schema.Array(GameShellAuthoringCommandDocument)),
    screens: Schema.Array(GameShellScreenDocument),
    screenOrder: Schema.Array(ScreenId),
    assets: Schema.Array(GameShellAssetRefDocument),
    tokens: GameShellDesignTokensDocument,
    entryScreenId: ScreenId,
  }).pipe(
    Schema.check(
      Schema.makeFilter(validateDocumentInvariants, {
        message: 'game shell document must satisfy durable navigation invariants',
      }),
    ),
  );
}

export class GameShellDefaultsDocument extends Schema.Class<GameShellDefaultsDocument>(
  'GameShellDefaultsDocument',
)({
  pluginId: NonEmptyString,
  screens: Schema.Array(GameShellScreenDocument),
  screenOrder: Schema.Array(ScreenId),
  assets: Schema.Array(GameShellAssetRefDocument),
  tokens: GameShellDesignTokensDocument,
  entryScreenId: ScreenId,
}) {
  static readonly validate = Schema.Struct({
    pluginId: NonEmptyString,
    screens: Schema.Array(GameShellScreenDocument),
    screenOrder: Schema.Array(ScreenId),
    assets: Schema.Array(GameShellAssetRefDocument),
    tokens: GameShellDesignTokensDocument,
    entryScreenId: ScreenId,
  }).pipe(
    Schema.check(
      Schema.makeFilter(validateDocumentInvariants, {
        message: 'game shell defaults must satisfy navigation invariants',
      }),
    ),
  );
}

export class RuntimeGameShellProjectionDocument extends Schema.Class<RuntimeGameShellProjectionDocument>(
  'RuntimeGameShellProjectionDocument',
)({
  schemaVersion: Schema.Literal(PROJECT_GAME_SHELL_DOCUMENT_SCHEMA_VERSION),
  pluginId: NonEmptyString,
  entryScreenId: ScreenId,
  screens: Schema.Array(GameShellScreenDocument),
  screenOrder: Schema.Array(ScreenId),
  assets: Schema.Array(GameShellAssetRefDocument),
  tokens: GameShellDesignTokensDocument,
  registeredEvents: Schema.Array(Schema.Literals(GAME_SHELL_REGISTERED_EVENTS)),
  diagnostics: Schema.Array(GameShellDiagnosticDocument),
}) {
  static readonly validate = Schema.Struct({
    schemaVersion: Schema.Literal(PROJECT_GAME_SHELL_DOCUMENT_SCHEMA_VERSION),
    pluginId: NonEmptyString,
    entryScreenId: ScreenId,
    screens: Schema.Array(GameShellScreenDocument),
    screenOrder: Schema.Array(ScreenId),
    assets: Schema.Array(GameShellAssetRefDocument),
    tokens: GameShellDesignTokensDocument,
    registeredEvents: Schema.Array(Schema.Literals(GAME_SHELL_REGISTERED_EVENTS)),
    diagnostics: Schema.Array(GameShellDiagnosticDocument),
  }).pipe(
    Schema.check(
      Schema.makeFilter(validateRuntimeProjectionInvariants, {
        message: 'runtime game shell projection must satisfy canonical shell invariants',
      }),
    ),
  );
}

export const defaultGameShellDesignTokens = (): GameShellDesignTokensDefinition => ({
  fontFamily: 'Inter',
  textColor: '#f8fafc',
  accentColor: '#38bdf8',
  panelColor: '#111827',
  focusColor: '#facc15',
  spacing: 'comfortable',
  motion: 'standard',
});

const action = (
  id: string,
  label: string,
  type: GameShellActionType,
  extra: Omit<GameShellActionDefinition, 'id' | 'label' | 'type'> = {},
): GameShellActionDefinition => ({ id, label, type, ...extra });

export const defaultProjectGameShellState = (
  pluginId = 'tileborne.default',
): GameShellAuthoringState => {
  const screens: readonly GameShellScreenDefinition[] = [
    {
      id: 'title',
      stableId: 'title',
      version: 1,
      kind: 'title',
      title: 'Tileborne',
      subtitle: 'Press start',
      enabled: true,
      layout: 'center',
      actions: [
        action('title.start', 'Start', 'navigate', { targetScreenId: 'main-menu' }),
        action('title.settings', 'Settings', 'navigate', { targetScreenId: 'settings' }),
      ],
    },
    {
      id: 'main-menu',
      stableId: 'main-menu',
      version: 1,
      kind: 'main-menu',
      title: 'Main Menu',
      subtitle: 'Choose a mode',
      enabled: true,
      layout: 'stack',
      actions: [
        action('menu.single', 'Single Player', 'start-single-player'),
        action('menu.multiplayer', 'Multiplayer', 'start-multiplayer'),
        action('menu.settings', 'Settings', 'navigate', { targetScreenId: 'settings' }),
      ],
    },
    {
      id: 'loading',
      stableId: 'loading',
      version: 1,
      kind: 'loading',
      title: 'Loading',
      subtitle: 'Preparing the match',
      enabled: true,
      layout: 'center',
      actions: [],
    },
    {
      id: 'pause',
      stableId: 'pause',
      version: 1,
      kind: 'pause',
      title: 'Paused',
      subtitle: 'Match suspended',
      enabled: true,
      layout: 'stack',
      actions: [
        action('pause.resume', 'Resume', 'resume'),
        action('pause.settings', 'Settings', 'navigate', { targetScreenId: 'settings' }),
        action('pause.exit', 'Exit', 'navigate', { targetScreenId: 'main-menu' }),
      ],
    },
    {
      id: 'settings',
      stableId: 'settings',
      version: 1,
      kind: 'settings',
      title: 'Settings',
      subtitle: 'Audio, display, and controls',
      enabled: true,
      layout: 'split',
      actions: [action('settings.back', 'Back', 'navigate', { targetScreenId: 'main-menu' })],
    },
    {
      id: 'results',
      stableId: 'results',
      version: 1,
      kind: 'results',
      title: 'Results',
      subtitle: 'Match complete',
      enabled: true,
      layout: 'stack',
      actions: [
        action('results.retry', 'Retry', 'retry'),
        action('results.menu', 'Main Menu', 'navigate', { targetScreenId: 'main-menu' }),
      ],
    },
  ];
  return {
    pluginId,
    screensById: Object.fromEntries(screens.map((screen) => [screen.id, screen])),
    screenOrder: screens.map((screen) => screen.id),
    assetsById: {},
    tokens: defaultGameShellDesignTokens(),
    entryScreenId: 'title',
  };
};

export const gameShellStateFromDefaults = (
  defaults?: GameShellDefaultsDefinition | undefined,
): GameShellAuthoringState => {
  if (defaults === undefined) return defaultProjectGameShellState();
  const fallback = defaultProjectGameShellState(defaults.pluginId);
  const screens = defaults.screens ?? Object.values(fallback.screensById);
  const screensById = Object.fromEntries(screens.map((screen) => [screen.id, screen]));
  return {
    pluginId: defaults.pluginId,
    screensById,
    screenOrder: defaults.screenOrder ?? screens.map((screen) => screen.id),
    assetsById: Object.fromEntries((defaults.assets ?? []).map((asset) => [asset.assetId, asset])),
    tokens: defaults.tokens ?? fallback.tokens,
    entryScreenId: defaults.entryScreenId ?? fallback.entryScreenId,
  };
};

export const gameShellStateFromDocument = (
  document: ProjectGameShellDocument,
): GameShellAuthoringState => ({
  pluginId: document.pluginId,
  screensById: Object.fromEntries(document.screens.map((screen) => [screen.id, screen])),
  screenOrder: [...document.screenOrder],
  assetsById: Object.fromEntries(document.assets.map((asset) => [asset.assetId, asset])),
  tokens: document.tokens,
  entryScreenId: document.entryScreenId,
});

export const projectGameShellDocumentFromState = (
  state: GameShellAuthoringState,
): ProjectGameShellDocument =>
  new ProjectGameShellDocument({
    schemaVersion: PROJECT_GAME_SHELL_DOCUMENT_SCHEMA_VERSION,
    pluginId: state.pluginId,
    projectOverrides: [],
    screens: state.screenOrder
      .map((screenId) => state.screensById[screenId])
      .filter((screen): screen is GameShellScreenDefinition => screen !== undefined)
      .map((screen) => new GameShellScreenDocument(screen)),
    screenOrder: [...state.screenOrder],
    assets: Object.values(state.assetsById).map((asset) => new GameShellAssetRefDocument(asset)),
    tokens: new GameShellDesignTokensDocument(state.tokens),
    entryScreenId: state.entryScreenId,
  });

const gameShellAuthoringCommandDocumentFromCommand = (
  command: GameShellAuthoringCommand,
): typeof GameShellAuthoringCommandDocument.Type => {
  switch (command.type) {
    case 'register-asset':
      return { ...command, asset: new GameShellAssetRefDocument(command.asset) };
    case 'upsert-action':
      return { ...command, action: new GameShellActionDocument(command.action) };
    default:
      return command;
  }
};

export const projectGameShellDocumentWithOverrides = (
  state: GameShellAuthoringState,
  projectOverrides: readonly GameShellAuthoringCommand[] = [],
): ProjectGameShellDocument =>
  new ProjectGameShellDocument({
    ...projectGameShellDocumentFromState(state),
    projectOverrides: projectOverrides.map(gameShellAuthoringCommandDocumentFromCommand),
  });

export const resolveProjectGameShellDocument = (
  document: ProjectGameShellDocument | undefined,
  defaults?: GameShellDefaultsDefinition | undefined,
): ProjectGameShellDocument => {
  if (document === undefined) {
    return projectGameShellDocumentWithOverrides(gameShellStateFromDefaults(defaults));
  }
  const overrides = document.projectOverrides ?? [];
  if (overrides.length === 0) return document;
  const base = gameShellStateFromDefaults(defaults ?? { pluginId: document.pluginId });
  const state = overrides.reduce(applyGameShellAuthoringCommand, base);
  return projectGameShellDocumentWithOverrides(state, overrides);
};

export const decodeProjectGameShellDocument = (
  value: unknown,
): ProjectGameShellDocument | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(ProjectGameShellDocument.validate)(value));

export const decodeRuntimeGameShellProjection = (
  value: unknown,
): RuntimeGameShellProjection | undefined =>
  Option.getOrUndefined(
    Schema.decodeUnknownOption(RuntimeGameShellProjectionDocument.validate)(value),
  );

export const decodeGameShellDefaultsDefinition = (
  pluginId: string,
  value: unknown,
): GameShellDefaultsDefinition | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(GameShellDefaultsDocument.validate)({ ...value, pluginId }),
  );
};

const updateScreen = (
  state: GameShellAuthoringState,
  screenId: string,
  update: (screen: GameShellScreenDefinition) => GameShellScreenDefinition,
): GameShellAuthoringState => {
  const screen = state.screensById[screenId];
  if (screen === undefined) return state;
  return { ...state, screensById: { ...state.screensById, [screenId]: update(screen) } };
};

export const applyGameShellAuthoringCommand = (
  state: GameShellAuthoringState,
  command: GameShellAuthoringCommand,
): GameShellAuthoringState => {
  switch (command.type) {
    case 'apply-plugin-defaults':
      return {
        ...defaultProjectGameShellState(command.pluginId),
        assetsById: state.assetsById,
        tokens: state.tokens,
      };
    case 'set-screen-text':
      return updateScreen(state, command.screenId, (screen) => ({
        ...screen,
        title: command.title,
        subtitle: command.subtitle,
        version: screen.version + 1,
      }));
    case 'set-screen-layout':
      return updateScreen(state, command.screenId, (screen) => ({
        ...screen,
        layout: command.layout,
        version: screen.version + 1,
      }));
    case 'set-screen-enabled':
      return updateScreen(state, command.screenId, (screen) => ({
        ...screen,
        enabled: command.enabled,
        version: screen.version + 1,
      }));
    case 'set-screen-order': {
      const existing = new Set(Object.keys(state.screensById));
      const ordered = command.screenOrder.filter((screenId) => existing.has(screenId));
      const missing = [...existing].filter((screenId) => !ordered.includes(screenId));
      return { ...state, screenOrder: [...ordered, ...missing] };
    }
    case 'set-entry-screen':
      return state.screensById[command.screenId] === undefined
        ? state
        : { ...state, entryScreenId: command.screenId };
    case 'set-design-tokens': {
      const patch = Object.fromEntries(
        Object.entries(command.tokens).filter(([, value]) => value !== undefined),
      ) as Partial<GameShellDesignTokensDefinition>;
      return { ...state, tokens: { ...state.tokens, ...patch } };
    }
    case 'register-asset':
      return {
        ...state,
        assetsById: { ...state.assetsById, [command.asset.assetId]: command.asset },
      };
    case 'set-screen-asset':
      return updateScreen(state, command.screenId, (screen) => ({
        ...screen,
        version: screen.version + 1,
        ...(command.slot === 'background'
          ? { backgroundAssetId: command.assetId }
          : { fontAssetId: command.assetId }),
      }));
    case 'upsert-action':
      return updateScreen(state, command.screenId, (screen) => ({
        ...screen,
        version: screen.version + 1,
        actions: [
          ...screen.actions.filter((entry) => entry.id !== command.action.id),
          command.action,
        ],
      }));
    case 'remove-action':
      return updateScreen(state, command.screenId, (screen) => ({
        ...screen,
        version: screen.version + 1,
        actions: screen.actions.filter((entry) => entry.id !== command.actionId),
      }));
  }
};

const isValidAssetKind = (
  asset: GameShellAssetRefDefinition | undefined,
  kind: GameShellAssetKind,
): boolean => {
  if (asset === undefined || asset.kind !== kind) return false;
  if (kind === 'background') return asset.mime.startsWith('image/');
  return asset.mime.startsWith('font/') || asset.mime === 'application/font-woff2';
};

export const buildRuntimeGameShellProjection = (
  state: GameShellAuthoringState,
  options: RuntimeGameShellProjectionOptions = {},
): RuntimeGameShellProjection => {
  const diagnostics: GameShellDiagnostic[] = [];
  const screens = state.screenOrder
    .map((screenId) => state.screensById[screenId])
    .filter((screen): screen is GameShellScreenDefinition => screen !== undefined);
  const screensById = new Map(screens.map((screen) => [screen.id, screen]));
  for (const required of GAME_SHELL_REQUIRED_SCREEN_IDS) {
    const screen = screens.find((entry) => entry.stableId === required);
    if (screen === undefined)
      diagnostics.push({
        code: 'missing-required-screen',
        path: `shell.screens.${required}`,
        message: `Required shell screen "${required}" is missing.`,
      });
    else if (!screen.enabled)
      diagnostics.push({
        code: 'disabled-required-screen',
        path: `shell.screens.${screen.id}.enabled`,
        message: `Required shell screen "${screen.title}" is disabled.`,
      });
  }
  if (!screensById.has(state.entryScreenId))
    diagnostics.push({
      code: 'invalid-route',
      path: 'shell.entryScreenId',
      message: `Shell entry screen "${state.entryScreenId}" does not exist.`,
    });
  for (const screen of screens) {
    const background =
      screen.backgroundAssetId === undefined
        ? undefined
        : state.assetsById[screen.backgroundAssetId];
    if (screen.backgroundAssetId !== undefined && !isValidAssetKind(background, 'background'))
      diagnostics.push({
        code: 'missing-asset',
        path: `shell.screens.${screen.id}.backgroundAssetId`,
        message: `Screen "${screen.title}" references a missing or non-image background asset.`,
      });
    else if (background !== undefined) {
      const resolution = options.resolveAsset?.(background, 'background');
      if (resolution !== undefined && !resolution.ok)
        diagnostics.push({
          code: 'missing-asset',
          path: `shell.screens.${screen.id}.backgroundAssetId`,
          message:
            resolution.message ??
            `Screen "${screen.title}" references a background asset that is not installed.`,
        });
    }
    const font =
      screen.fontAssetId === undefined ? undefined : state.assetsById[screen.fontAssetId];
    if (screen.fontAssetId !== undefined && !isValidAssetKind(font, 'font'))
      diagnostics.push({
        code: 'missing-font',
        path: `shell.screens.${screen.id}.fontAssetId`,
        message: `Screen "${screen.title}" references a missing or non-font asset.`,
      });
    else if (font !== undefined) {
      const resolution = options.resolveAsset?.(font, 'font');
      if (resolution !== undefined && !resolution.ok)
        diagnostics.push({
          code: 'missing-font',
          path: `shell.screens.${screen.id}.fontAssetId`,
          message:
            resolution.message ??
            `Screen "${screen.title}" references a font asset that is not installed.`,
        });
    }
    for (const actionEntry of screen.actions) {
      if (actionEntry.type === 'navigate' && !screensById.has(actionEntry.targetScreenId ?? ''))
        diagnostics.push({
          code: 'invalid-route',
          path: `shell.screens.${screen.id}.actions.${actionEntry.id}.targetScreenId`,
          message: `Action "${actionEntry.label}" navigates to a missing screen.`,
        });
      if (actionEntry.type === 'emit-event' && actionEntry.event === undefined)
        diagnostics.push({
          code: 'invalid-event',
          path: `shell.screens.${screen.id}.actions.${actionEntry.id}.event`,
          message: `Action "${actionEntry.label}" must choose a registered shell event.`,
        });
    }
  }
  const reachable = new Set<string>();
  const visit = (screenId: string) => {
    if (reachable.has(screenId)) return;
    const screen = screensById.get(screenId);
    if (screen === undefined || !screen.enabled) return;
    reachable.add(screenId);
    for (const actionEntry of screen.actions)
      if (actionEntry.type === 'navigate' && actionEntry.targetScreenId !== undefined)
        visit(actionEntry.targetScreenId);
  };
  visit(state.entryScreenId);
  for (const screen of screens.filter((entry) => entry.enabled)) {
    if (
      GAME_SHELL_NAVIGATION_REQUIRED_SCREEN_IDS.has(screen.stableId) &&
      !reachable.has(screen.id)
    ) {
      diagnostics.push({
        code: 'unreachable-required-screen',
        path: `shell.screens.${screen.id}`,
        message: `Required shell screen "${screen.title}" is not reachable from the entry screen.`,
      });
    }
  }
  return {
    schemaVersion: PROJECT_GAME_SHELL_DOCUMENT_SCHEMA_VERSION,
    pluginId: state.pluginId,
    entryScreenId: state.entryScreenId,
    screens,
    screenOrder: [...state.screenOrder],
    assets: Object.values(state.assetsById),
    tokens: state.tokens,
    registeredEvents: GAME_SHELL_REGISTERED_EVENTS,
    diagnostics,
  };
};
