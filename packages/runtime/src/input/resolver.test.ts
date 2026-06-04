import {
  CONTROL_SCHEMES,
  CORE_ACTIONS,
  InputMap,
  coreActionId,
  makeControlScheme,
  type ActionState,
} from "@tileborne/core";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { KeyInputEvent, MouseButtonInputEvent, MouseMoveInputEvent, type InputEvent } from "./input.js";
import { InputResolver } from "./resolver.js";

const SCHEME = makeControlScheme(CONTROL_SCHEMES.KeyboardMouse);

const PRIMARY = coreActionId(CORE_ACTIONS.PrimaryAction);
const MOVE = coreActionId(CORE_ACTIONS.Move);
const AIM = coreActionId(CORE_ACTIONS.Aim);
const SLOT1 = coreActionId(CORE_ACTIONS.Slot1);

// A minimal data-declared map (the resolver has NO baked switch — this DATA is
// the entire binding identity). PrimaryAction is bound to BOTH Space and mouse-0.
const TEST_MAP_DATA = {
  id: "test-map",
  actions: [
    { action: CORE_ACTIONS.PrimaryAction, valueKind: "digital" },
    { action: CORE_ACTIONS.Move, valueKind: "analog2d" },
    { action: CORE_ACTIONS.Aim, valueKind: "pointer" },
    { action: CORE_ACTIONS.Slot1, valueKind: "digital" },
  ],
  schemeDefaults: {
    "keyboard-mouse": [
      { _tag: "InputBinding", action: CORE_ACTIONS.PrimaryAction, trigger: { _tag: "key", code: "Space" } },
      { _tag: "InputBinding", action: CORE_ACTIONS.PrimaryAction, trigger: { _tag: "mouseButton", button: 0 } },
      { _tag: "InputBinding", action: CORE_ACTIONS.Move, trigger: { _tag: "key", code: "KeyD" }, axisRole: "x+" },
      { _tag: "InputBinding", action: CORE_ACTIONS.Move, trigger: { _tag: "key", code: "KeyA" }, axisRole: "x-" },
      { _tag: "InputBinding", action: CORE_ACTIONS.Move, trigger: { _tag: "key", code: "KeyW" }, axisRole: "y-" },
      { _tag: "InputBinding", action: CORE_ACTIONS.Aim, trigger: { _tag: "pointer" } },
      { _tag: "InputBinding", action: CORE_ACTIONS.Slot1, trigger: { _tag: "key", code: "Digit1" } },
    ],
  },
};

const buildMap = (): InputMap => Schema.decodeUnknownSync(InputMap)(TEST_MAP_DATA);

const makeResolver = (): InputResolver => new InputResolver(buildMap(), SCHEME);

describe("InputResolver — PrimaryAction is bindable to key OR mouse (ADR-0024 headline)", () => {
  it("resolves PrimaryAction.pressed from the bound Space key", () => {
    const resolver = makeResolver();
    resolver.apply(new KeyInputEvent({ tick: 1, code: "Space", pressed: true }));
    const state = resolver.resolve();
    expect(state.digital.get(PRIMARY)).toEqual({ pressed: true, justPressed: true, justReleased: false });
  });

  it("resolves PrimaryAction.pressed from the bound mouse button — same neutral action", () => {
    const resolver = makeResolver();
    resolver.apply(new MouseButtonInputEvent({ tick: 1, button: 0, pressed: true }));
    const state = resolver.resolve();
    expect(state.digital.get(PRIMARY)?.pressed).toBe(true);
  });

  it("reports justPressed once, then held, then justReleased", () => {
    const resolver = makeResolver();
    resolver.apply(new KeyInputEvent({ tick: 1, code: "Space", pressed: true }));
    expect(resolver.resolve().digital.get(PRIMARY)?.justPressed).toBe(true);
    expect(resolver.resolve().digital.get(PRIMARY)).toEqual({
      pressed: true,
      justPressed: false,
      justReleased: false,
    });
    resolver.apply(new KeyInputEvent({ tick: 2, code: "Space", pressed: false }));
    expect(resolver.resolve().digital.get(PRIMARY)).toEqual({
      pressed: false,
      justPressed: false,
      justReleased: true,
    });
  });
});

describe("InputResolver — analog + pointer + slot resolution", () => {
  it("fills Move as an analog2d vector from key bindings + axis roles", () => {
    const resolver = makeResolver();
    resolver.apply(new KeyInputEvent({ tick: 1, code: "KeyD", pressed: true }));
    expect(resolver.resolve().analog.get(MOVE)).toEqual({ x: 1, y: 0 });
    resolver.apply(new KeyInputEvent({ tick: 1, code: "KeyW", pressed: true }));
    expect(resolver.resolve().analog.get(MOVE)).toEqual({ x: 1, y: -1 });
    resolver.apply(new KeyInputEvent({ tick: 2, code: "KeyA", pressed: true }));
    // D (x+1) and A (x-1) cancel; W (y-1) remains.
    expect(resolver.resolve().analog.get(MOVE)).toEqual({ x: 0, y: -1 });
  });

  it("fills Aim as a pointer position from the bound pointer trigger", () => {
    const resolver = makeResolver();
    resolver.apply(new MouseMoveInputEvent({ tick: 1, x: 42, y: 17 }));
    expect(resolver.resolve().pointer.get(AIM)).toEqual({ x: 42, y: 17 });
  });

  it("reports a slot selector as a digital just-pressed edge", () => {
    const resolver = makeResolver();
    resolver.apply(new KeyInputEvent({ tick: 1, code: "Digit1", pressed: true }));
    expect(resolver.resolve().digital.get(SLOT1)?.justPressed).toBe(true);
    expect(resolver.resolve().digital.get(SLOT1)?.justPressed).toBe(false);
  });
});

describe("InputResolver — determinism (remap round-trip)", () => {
  const serialize = (state: ActionState): unknown => ({
    digital: [...state.digital].sort(([a], [b]) => a.localeCompare(b)),
    analog: [...state.analog].sort(([a], [b]) => a.localeCompare(b)),
    pointer: [...state.pointer].sort(([a], [b]) => a.localeCompare(b)),
  });

  it("yields identical ActionState for the same effective map + raw event log", () => {
    const log: readonly InputEvent[] = [
      new KeyInputEvent({ tick: 1, code: "KeyD", pressed: true }),
      new KeyInputEvent({ tick: 1, code: "Space", pressed: true }),
      new MouseMoveInputEvent({ tick: 1, x: 5, y: 9 }),
    ];
    const a = new InputResolver(buildMap(), SCHEME);
    const b = new InputResolver(buildMap(), SCHEME);
    a.applyMany(log);
    b.applyMany(log);
    expect(serialize(a.resolve())).toEqual(serialize(b.resolve()));
  });
});
