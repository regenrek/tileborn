import { AssetId } from "@tileborne/core";
import { Schema } from "effect";

import { License } from "./license.js";

export class LicenseManifestEntry extends Schema.Class<LicenseManifestEntry>(
  "LicenseManifestEntry",
)({
  assetId: AssetId,
  license: License,
}) {}

export class LicenseManifest extends Schema.Class<LicenseManifest>("LicenseManifest")({
  packLicense: License,
  assets: Schema.Array(LicenseManifestEntry),
}) {}
