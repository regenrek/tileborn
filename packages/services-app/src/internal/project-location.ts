import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { ProjectId, ProjectManifestSchema } from "@tileborne/core";
import { Schema } from "effect";

import { projectDirectory, projectManifestPath } from "./layout.js";

const isNotFound = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";

export interface DiscoveredProject {
  readonly root: string;
  readonly id: ProjectId;
  readonly name: string;
}

const readManifestSummary = async (projectRoot: string): Promise<DiscoveredProject | undefined> => {
  const manifestFile = projectManifestPath(projectRoot);
  try {
    await access(manifestFile);
    const raw = await readFile(manifestFile, "utf8");
    const manifest = Schema.decodeUnknownSync(ProjectManifestSchema)(JSON.parse(raw));
    return { root: projectRoot, id: manifest.id, name: manifest.name };
  } catch (cause) {
    if (isNotFound(cause)) {
      return undefined;
    }
    return undefined;
  }
};

export const findProjectInAncestors = async (
  startDir: string,
  projectId?: ProjectId,
): Promise<DiscoveredProject | undefined> => {
  let current = path.resolve(startDir);
  const fsRoot = path.parse(current).root;
  while (true) {
    const discovered = await readManifestSummary(current);
    if (discovered && (projectId === undefined || discovered.id === projectId)) {
      return discovered;
    }
    if (current === fsRoot) {
      return undefined;
    }
    current = path.dirname(current);
  }
};

export const homeProjectRoot = (projectsRoot: string, projectId: ProjectId): string =>
  projectDirectory(projectsRoot, projectId);

export const homeProjectExists = async (projectsRoot: string, projectId: ProjectId): Promise<boolean> => {
  try {
    await access(projectManifestPath(homeProjectRoot(projectsRoot, projectId)));
    return true;
  } catch {
    return false;
  }
};
