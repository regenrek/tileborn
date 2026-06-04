import { CONTROL_SCHEMES, CORE_ACTIONS, InputMap, controlScheme } from "@tileborne/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ControlsTab } from "./controls-tab.js";
import { createLocalStorageBindingsStore } from "../input/user-bindings.js";

const SCHEME = controlScheme(CONTROL_SCHEMES.KeyboardMouse);

/** A minimal plugin-default map: PrimaryAction→Space (digital, remappable). */
const baseMap = (): InputMap =>
  Schema.decodeUnknownSync(InputMap)({
    id: "plugin-default",
    actions: [{ action: CORE_ACTIONS.PrimaryAction, valueKind: "digital" }],
    schemeDefaults: {
      "keyboard-mouse": [
        {
          _tag: "InputBinding",
          action: CORE_ACTIONS.PrimaryAction,
          trigger: { _tag: "key", code: "Space" },
        },
      ],
    },
  });

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const PRIMARY = CORE_ACTIONS.PrimaryAction as string;

describe("ControlsTab", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not capture a Cancel click as a mouse-button rebind", async () => {
    const user = userEvent.setup();
    const store = createLocalStorageBindingsStore({ storage: new MemoryStorage() });
    render(<ControlsTab inputMap={baseMap()} scheme={SCHEME} store={store} />);

    const binding = screen.getByTestId(`controls-binding-${PRIMARY}`);
    expect(binding.textContent).toBe("Space");

    // Start capture: the Rebind button becomes "Cancel" and prompts for input.
    await user.click(screen.getByTestId(`controls-rebind-${PRIMARY}`));
    expect(binding.textContent).toBe("Press a key or mouse button…");

    // Clicking Cancel fires a `mousedown` on `window` BEFORE the button's click.
    // The fix ignores presses inside the controls UI, so the binding must NOT be
    // rebound to the mouse button — Cancel simply ends the capture.
    await user.click(screen.getByTestId(`controls-rebind-${PRIMARY}`));

    expect(binding.textContent).toBe("Space");
    // Capture ended: the button reads "Rebind" again (no lingering "Cancel").
    expect(screen.getByTestId(`controls-rebind-${PRIMARY}`).textContent).toBe("Rebind");
  });

  it("captures a real key press OUTSIDE the controls UI as the new binding", async () => {
    const user = userEvent.setup();
    const store = createLocalStorageBindingsStore({ storage: new MemoryStorage() });
    render(<ControlsTab inputMap={baseMap()} scheme={SCHEME} store={store} />);

    await user.click(screen.getByTestId(`controls-rebind-${PRIMARY}`));
    // A key press is a valid rebind trigger (it never targets the controls UI).
    await user.keyboard("f");

    expect(screen.getByTestId(`controls-binding-${PRIMARY}`).textContent).toBe("F");
  });
});
