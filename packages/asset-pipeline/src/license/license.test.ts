import { makeAssetId } from "@tileborne/core";
import { Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { LicenseNotAllowlistedError } from "../errors.js";
import { License, SPDX_ALLOWLIST, validateLicenseAllowlist } from "./license.js";
import { LicenseManifest, LicenseManifestEntry } from "./license-manifest.js";

const license = (spdxId: string): License =>
  new License({
    spdxId,
    attribution: Option.none(),
    sourceUrl: Option.none(),
    notes: Option.none(),
  });

describe("License schema", () => {
  it("decodes omitted optional keys as none", () => {
    const decoded = Schema.decodeUnknownSync(License)({ spdxId: "MIT" });

    expect(Option.isNone(decoded.attribution)).toBe(true);
    expect(Option.isNone(decoded.sourceUrl)).toBe(true);
    expect(Option.isNone(decoded.notes)).toBe(true);
  });

  it("decodes explicit undefined optional keys as none", () => {
    const decoded = Schema.decodeUnknownSync(License)({
      spdxId: "MIT",
      attribution: undefined,
      sourceUrl: undefined,
      notes: undefined,
    });

    expect(Option.isNone(decoded.attribution)).toBe(true);
    expect(Option.isNone(decoded.sourceUrl)).toBe(true);
    expect(Option.isNone(decoded.notes)).toBe(true);
  });

  it("decodes explicit optional strings as some", () => {
    const decoded = Schema.decodeUnknownSync(License)({
      spdxId: "MIT",
      attribution: "Author",
    });

    expect(Option.isSome(decoded.attribution)).toBe(true);
    if (Option.isSome(decoded.attribution)) {
      expect(decoded.attribution.value).toBe("Author");
    }
  });

  it("encodes none optional fields as omitted keys", () => {
    const encoded = Schema.encodeSync(License)(license("MIT"));

    expect(encoded).toEqual({ spdxId: "MIT" });
    expect("attribution" in encoded).toBe(false);
    expect("sourceUrl" in encoded).toBe(false);
    expect("notes" in encoded).toBe(false);
  });

  it("encodes some optional fields as string keys", () => {
    const encoded = Schema.encodeSync(License)(
      new License({
        spdxId: "MIT",
        attribution: Option.some("Author"),
        sourceUrl: Option.some("https://example.invalid/license"),
        notes: Option.none(),
      }),
    );

    expect(encoded).toEqual({
      spdxId: "MIT",
      attribution: "Author",
      sourceUrl: "https://example.invalid/license",
    });
  });
});

describe("license allowlist", () => {
  it("accepts common allowlisted licenses", () => {
    expect(SPDX_ALLOWLIST).toContain("CC0-1.0");
    expect(SPDX_ALLOWLIST).toContain("MIT");
    expect(Result.isSuccess(validateLicenseAllowlist(license("CC0-1.0")))).toBe(true);
    expect(Result.isSuccess(validateLicenseAllowlist(license("MIT")))).toBe(true);
  });

  it("flags non-allowlisted SPDX ids for explicit approval", () => {
    const result = validateLicenseAllowlist(license("LicenseRef-Commercial-Unknown"));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(LicenseNotAllowlistedError);
    }
  });

  it("binds per-asset licenses in a manifest", () => {
    const assetId = makeAssetId("550e8400-e29b-41d4-a716-446655440000");
    const manifest = new LicenseManifest({
      packLicense: license("CC0-1.0"),
      assets: [
        new LicenseManifestEntry({
          assetId,
          license: license("MIT"),
        }),
      ],
    });

    expect(manifest.assets[0]?.assetId).toBe(assetId);
    expect(manifest.assets[0]?.license.spdxId).toBe("MIT");
  });
});
