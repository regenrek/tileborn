import { describe, expect, it } from "vitest";

import {
  findDuplicateSectionIds,
  sectionsForSlot,
  type MenuSectionRegistration,
} from "./menu-registry.js";

const Noop = () => null;

const reg = (
  id: string,
  slot: MenuSectionRegistration["slot"],
  order?: number,
  source?: MenuSectionRegistration["source"],
): MenuSectionRegistration => ({ id, slot, order, source, Component: Noop });

describe("sectionsForSlot", () => {
  it("filters by slot and orders by `order` then registration order", () => {
    const registrations = [
      reg("c", "main.primaryActions", 30),
      reg("a", "main.primaryActions", 10),
      reg("b", "main.primaryActions", 10),
      reg("other", "settings.tabs", 5),
    ];
    expect(sectionsForSlot(registrations, "main.primaryActions").map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(sectionsForSlot(registrations, "settings.tabs").map((r) => r.id)).toEqual(["other"]);
  });

  it("sorts sections without an order after explicitly ordered ones", () => {
    const registrations = [
      reg("late", "main.primaryActions"),
      reg("first", "main.primaryActions", 1),
    ];
    expect(sectionsForSlot(registrations, "main.primaryActions").map((r) => r.id)).toEqual([
      "first",
      "late",
    ]);
  });

  it("detects duplicate ids within the same slot", () => {
    const registrations = [
      reg("dup", "main.tabs", 1, "plugin"),
      reg("dup", "main.tabs", 2, "brand"),
      reg("unique", "main.tabs"),
    ];
    expect(findDuplicateSectionIds(registrations)).toEqual(["main.tabs:dup"]);
  });

  it("treats the same id in different slots as unique", () => {
    const registrations = [reg("x", "main.tabs"), reg("x", "settings.tabs")];
    expect(findDuplicateSectionIds(registrations)).toEqual([]);
  });
});
