import {
  ControlScheme,
  InputBinding,
  InputMap,
  type ActionDeclaration,
  type ActionId,
} from '@tileborne/core';
import { Option, Result, Schema } from 'effect';

/**
 * Consumption of the typed `RuntimeInputMapContribution` slot (ADR-0024 Slice 3).
 *
 * Mirrors {@link decodeWeaponCatalog} / ADR-0019's catalog registry: the engine
 * owns the `@tileborne/core` `InputMap` SHAPE; the plugin supplies the binding
 * DATA. This helper decodes the contribution `data` against the core schema and
 * overlays the user's persisted remaps on top of the plugin defaults to produce
 * the EFFECTIVE map the runtime `InputResolver` consumes. The untyped
 * `JsonObject` consumption path is hard-cut: this typed decode is the only path.
 */

/** A contributed input map failed to decode against the `@tileborne/core` schema. */
export class InvalidInputMapContributionError extends Schema.TaggedErrorClass<InvalidInputMapContributionError>()(
  'InvalidInputMapContributionError',
  {
    contributionId: Schema.String,
    message: Schema.String,
  },
) {}

/** Decode raw contribution `data` into a typed `@tileborne/core` {@link InputMap}. */
export const decodeInputMap = (
  contributionId: string,
  data: unknown,
): Result.Result<InputMap, InvalidInputMapContributionError> => {
  const decoded = Schema.decodeUnknownOption(InputMap)(data);
  return Option.match(decoded, {
    onNone: () =>
      Result.fail(
        new InvalidInputMapContributionError({
          contributionId,
          message: `contribution ${contributionId} is not a valid InputMap`,
        }),
      ),
    onSome: (map) => Result.succeed(map),
  });
};

const dedupeActionDeclarations = (
  declarations: readonly ActionDeclaration[],
): readonly ActionDeclaration[] => {
  const byAction = new Map<string, ActionDeclaration>();
  for (const declaration of declarations) {
    byAction.set(declaration.action as string, declaration);
  }
  return [...byAction.values()];
};

/**
 * Overlay a user remap {@link InputMap} on top of the plugin default map to build
 * the EFFECTIVE map fed to the resolver (ADR-0024). Non-destructive: for each
 * control scheme, an overlaid action REPLACES the plugin's bindings for that
 * action+scheme; unremapped actions keep their plugin defaults. The declared
 * action set is the union. With no overlay this returns the plugin defaults
 * unchanged — the seam the user-remap/persistence slice (`t-gae-input-remap`)
 * plugs its loaded overlay into.
 */
export const resolveEffectiveInputMap = (
  pluginDefault: InputMap,
  userOverlay?: InputMap,
): InputMap => {
  if (userOverlay === undefined) {
    return pluginDefault;
  }

  const schemes = new Set<ControlScheme>([
    ...(Object.keys(pluginDefault.schemeDefaults) as ControlScheme[]),
    ...(Object.keys(userOverlay.schemeDefaults) as ControlScheme[]),
  ]);

  const schemeDefaults: Record<ControlScheme, readonly InputBinding[]> = {} as Record<
    ControlScheme,
    readonly InputBinding[]
  >;
  for (const scheme of schemes) {
    const base = pluginDefault.schemeDefaults[scheme] ?? [];
    const overlay = userOverlay.schemeDefaults[scheme] ?? [];
    const remappedActions = new Set<string>(overlay.map((binding) => binding.action as string));
    const keptBase = base.filter((binding) => !remappedActions.has(binding.action as string));
    schemeDefaults[scheme] = [...keptBase, ...overlay];
  }

  return new InputMap({
    id: userOverlay.id,
    actions: dedupeActionDeclarations([...pluginDefault.actions, ...userOverlay.actions]),
    schemeDefaults,
  });
};

/**
 * Structural check that every action bound in any scheme is declared (with a
 * value kind) in the map's action list — the resolver only fills DECLARED
 * actions, so an undeclared bound action would silently no-op. Returns the
 * undeclared action ids (empty when valid).
 */
export const findUndeclaredBoundActions = (map: InputMap): readonly ActionId[] => {
  const declared = new Set<string>(map.actions.map((declaration) => declaration.action as string));
  const undeclared = new Set<ActionId>();
  for (const bindings of Object.values(map.schemeDefaults)) {
    for (const binding of bindings as readonly InputBinding[]) {
      if (!declared.has(binding.action as string)) {
        undeclared.add(binding.action);
      }
    }
  }
  return [...undeclared];
};
