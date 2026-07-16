import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateAdrs } from "./generate-adrs.mjs";
import { generateApiReference } from "./generate-api-reference.mjs";
import { generateCliReference } from "./generate-cli-reference.mjs";
import { syncContent } from "./sync-content.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsAppRoot = path.resolve(__dirname, "..");

const CANONICAL_PAGES = [
  "index",
  "getting-started",
  "architecture",
  "editor-ux",
  "runtime",
  "gameplay-behaviors",
  "battle-royale/creator-guide",
  "plugins",
  "cli",
  "adrs",
  "follow-ups",
  "reference",
];

const writeManifest = () => {
  const manifestPath = path.join(docsAppRoot, "src/generated/page-manifest.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        pages: CANONICAL_PAGES,
      },
      null,
      2,
    ),
    "utf8",
  );
};

syncContent();
generateAdrs();
generateCliReference();
generateApiReference();
writeManifest();

console.log("docs prebuild complete");
