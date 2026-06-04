import { CORE_ACTIONS, InputMap } from "@tileborne/core";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeInputMap,
  findUndeclaredBoundActions,
  resolveEffectiveInputMap,
} from "./input-map-registry.js";

const baseData = {
  id: "plugin-default",
  actions: [
    { action: CORE_ACTIONS.PrimaryAction, valueKind: "digital" },
    { action: CORE_ACTIONS.Move, valueKind: "analog2d" },
  ],
  schemeDefaults: {
    "keyboard-mouse": [
      { _tag: "InputBinding", action: CORE_ACTIONS.PrimaryAction, trigger: { _tag: "key", code: "Space" } },
      { _tag: "InputBinding", action: CORE_ACTIONS.Move, trigger: { _tag: "key", code: "KeyD" }, axisRole: "x+" },
    ],
  },
};

const decode = (data: unknown): InputMap => Schema.decodeUnknownSync(InputMap)(data);

describe("decodeInputMap", () => {
  it("decodes valid contribution data into a typed InputMap", () => {
    const result = decodeInputMap("br-input-map", baseData);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.id).toBe("plugin-default");
    }
  });

  it("fails on data that is not a valid InputMap", () => {
    const result = decodeInputMap("broken", { nope: true });
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("InvalidInputMapContributionError");
      expect(result.failure.contributionId).toBe("broken");
    }
  });
});

describe("resolveEffectiveInputMap (user remap overlay seam)", () => {
  it("returns the plugin defaults unchanged when there is no user overlay", () => {
    const base = decode(baseData);
    expect(resolveEffectiveInputMap(base)).toBe(base);
  });

  it("overlays a user remap: the remapped action's bindings replace the plugin default for that scheme", () => {
    const base = decode(baseData);
    // User rebinds PrimaryAction from Space to mouse-0; Move keeps its default.
    const overlay = decode({
      id: "user-overlay",
      actions: [{ action: CORE_ACTIONS.PrimaryAction, valueKind: "digital" }],
      schemeDefaults: {
        "keyboard-mouse": [
          {
            _tag: "InputBinding",
            action: CORE_ACTIONS.PrimaryAction,
            trigger: { _tag: "mouseButton", button: 0 },
          },
        ],
      },
    });
    const effective = resolveEffectiveInputMap(base, overlay);
    const bindings = effective.schemeDefaults["keyboard-mouse" as keyof typeof effective.schemeDefaults] ?? [];
    const primary = bindings.filter((binding) => binding.action === CORE_ACTIONS.PrimaryAction);
    expect(primary).toHaveLength(1);
    expect(primary[0]?.trigger._tag).toBe("mouseButton");
    // The unremapped Move binding is preserved.
    expect(bindings.some((binding) => binding.action === CORE_ACTIONS.Move)).toBe(true);
  });
});

describe("findUndeclaredBoundActions", () => {
  it("returns nothing when every bound action is declared", () => {
    expect(findUndeclaredBoundActions(decode(baseData))).toEqual([]);
  });

  it("flags a bound action missing a value-kind declaration", () => {
    const undeclared = findUndeclaredBoundActions(
      decode({
        id: "missing-decl",
        actions: [{ action: CORE_ACTIONS.Move, valueKind: "analog2d" }],
        schemeDefaults: {
          "keyboard-mouse": [
            { _tag: "InputBinding", action: CORE_ACTIONS.Reload, trigger: { _tag: "key", code: "KeyR" } },
          ],
        },
      }),
    );
    expect(undeclared).toContain(CORE_ACTIONS.Reload);
  });
});
