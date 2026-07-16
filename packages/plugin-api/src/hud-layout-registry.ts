import { HudLayout, type HudWidgetPlacement } from '@tileborne/core';
import { Option, Result, Schema } from 'effect';

/**
 * Consumption of the typed `RuntimeHudLayout` contribution slot.
 *
 * Mirrors {@link decodeInputMap} / ADR-0024: the engine owns the
 * `@tileborne/core` {@link HudLayout} SHAPE; the plugin supplies the placement
 * DATA. This helper decodes the contribution `data` against the core schema
 * and overlays the user's persisted HUD customisation on top of the plugin
 * default to produce the EFFECTIVE layout the HUD renderer consumes.
 */

/** A contributed HUD layout failed to decode against the `@tileborne/core` schema. */
export class InvalidHudLayoutContributionError extends Schema.TaggedErrorClass<InvalidHudLayoutContributionError>()(
  'InvalidHudLayoutContributionError',
  {
    contributionId: Schema.String,
    message: Schema.String,
  },
) {}

/** Decode raw contribution `data` into a typed `@tileborne/core` {@link HudLayout}. */
export const decodeHudLayout = (
  contributionId: string,
  data: unknown,
): Result.Result<HudLayout, InvalidHudLayoutContributionError> => {
  const decoded = Schema.decodeUnknownOption(HudLayout)(data);
  return Option.match(decoded, {
    onNone: () =>
      Result.fail(
        new InvalidHudLayoutContributionError({
          contributionId,
          message: `contribution ${contributionId} is not a valid HudLayout`,
        }),
      ),
    onSome: (layout) => Result.succeed(layout),
  });
};

/**
 * Overlay a user HUD customisation {@link HudLayout} on top of the plugin
 * default layout to build the EFFECTIVE layout the HUD renderer consumes.
 * Non-destructive merge keyed by widget-instance id:
 * - an overlay placement REPLACES the default placement with the same id
 *   (move / reorder / disable / re-anchor);
 * - overlay-only placements are APPENDED (extra widget instances);
 * - untouched default placements are kept as-is.
 * With no overlay this returns the plugin default unchanged.
 */
export const resolveEffectiveHudLayout = (
  pluginDefault: HudLayout,
  userOverlay?: HudLayout,
): HudLayout => {
  if (userOverlay === undefined) {
    return pluginDefault;
  }

  const overlayById = new Map<string, HudWidgetPlacement>(
    userOverlay.widgets.map((widget) => [widget.id as string, widget]),
  );
  const baseIds = new Set(pluginDefault.widgets.map((widget) => widget.id as string));

  const merged = [
    ...pluginDefault.widgets.map((widget) => overlayById.get(widget.id as string) ?? widget),
    ...userOverlay.widgets.filter((widget) => !baseIds.has(widget.id as string)),
  ];

  return new HudLayout({ id: userOverlay.id, widgets: merged });
};
