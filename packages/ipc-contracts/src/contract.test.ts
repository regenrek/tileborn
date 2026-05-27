import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { IpcClientOf, IpcHandlersOf } from "./codegen-shape.js";
import { defineContract } from "./contract.js";
import { IpcError } from "./errors.js";
import { createRegistry, getContract } from "./registry.js";

const TestRequest = Schema.Struct({ id: Schema.String });
const TestResponse = Schema.Struct({ ok: Schema.Boolean });

describe("defineContract and registry", () => {
  it("builds a contract and retrieves it by channel", () => {
    const contract = defineContract({
      channel: "tileborne:project:open",
      request: TestRequest,
      response: TestResponse,
      errors: IpcError,
    });
    const registry = createRegistry([contract] as const);

    expect(contract.channel).toBe("tileborne:project:open");
    expect(getContract(registry, "tileborne:project:open")).toBe(contract);
  });

  it("rejects duplicate channels", () => {
    const first = defineContract({
      channel: "tileborne:project:open",
      request: TestRequest,
      response: TestResponse,
      errors: IpcError,
    });
    const second = defineContract({
      channel: "tileborne:project:open",
      request: Schema.Struct({ other: Schema.String }),
      response: TestResponse,
      errors: IpcError,
    });

    expect(() => createRegistry([first, second] as const)).toThrow("Duplicate IPC channel");
  });

  it("derives compile-time client and handler shapes", () => {
    const contract = defineContract({
      channel: "tileborne:system:log",
      request: Schema.Struct({ message: Schema.String }),
      response: Schema.Struct({}),
      errors: IpcError,
    });
    const registry = createRegistry([contract] as const);
    expect(registry.contracts).toHaveLength(1);

    const client = {
      "tileborne:system:log": (request) => {
        request.message.toUpperCase();
        return Effect.succeed({});
      },
    } satisfies IpcClientOf<typeof registry>;

    const handlers = {
      "tileborne:system:log": (request) => {
        void request;
        return Effect.succeed({});
      },
    } satisfies IpcHandlersOf<typeof registry>;

    const assertClientInput = () => {
      // @ts-expect-error request payload must include message
      client["tileborne:system:log"]({});
    };
    void assertClientInput;

    expect(typeof handlers["tileborne:system:log"]).toBe("function");
  });
});
