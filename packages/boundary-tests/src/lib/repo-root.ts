import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

/** Monorepo root (`tileborn/`). */
export const repoRoot = path.resolve(packageRoot, "../../../..");
