import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { IpcChannel, makeIpcChannel, parseIpcChannel } from "./channel.js";

describe("IpcChannel", () => {
  it("constructs tileborne-prefixed channels", () => {
    expect(makeIpcChannel("tileborne:project:open")).toBe("tileborne:project:open");
    expect(Schema.decodeUnknownSync(IpcChannel)("tileborne:asset:resolveThumbnail")).toBe(
      "tileborne:asset:resolveThumbnail",
    );
  });

  it("rejects channels without the tileborne prefix", () => {
    expect(Result.isFailure(parseIpcChannel("project:open"))).toBe(true);
    expect(() => Schema.decodeUnknownSync(IpcChannel)("project:open")).toThrow();
  });
});
