import path from "node:path";
import { access, readFile } from "node:fs/promises";

import { MapId, ProjectId, ProjectManifestSchema } from "@tileborne/core";
import {
  findProjectInAncestors,
  findRegisteredProject,
  ProjectService,
} from "@tileborne/services-app";
import { ConfigService, HomeService } from "@tileborne/services-foundation";
import { Effect, Option, Schema } from "effect";

import { CliUsageError } from "../render/errors.js";

export const readProjectSlugArg = (
  args: Record<string, unknown>,
  key = "project",
): string | undefined => {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const readProjectIdFromPath = (projectRoot: string) =>
  Effect.tryPromise({
    try: async () => {
      const manifestPath = path.join(projectRoot, "project.json");
      await access(manifestPath);
      const raw = await readFile(manifestPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const manifest = Schema.decodeUnknownSync(ProjectManifestSchema)(parsed);
      return manifest.id;
    },
    catch: () => undefined as ProjectId | undefined,
  });

const resolveExplicitProjectId = (
  projectSlug: string,
  projectsRoot: string,
  cwd: string,
  lastOpened: Option.Option<string>,
) =>
  Effect.gen(function* () {
    const projects = yield* ProjectService;
    const summaries = yield* projects.list();
    const listed = summaries.find((entry) => entry.name === projectSlug || entry.id === projectSlug);
    if (listed) {
      return listed.id;
    }

    const registered = yield* findRegisteredProject(projectsRoot, projectSlug);
    if (registered) {
      return registered.id;
    }

    const slugRoot = path.join(projectsRoot, projectSlug);
    const fromSlugPath = yield* readProjectIdFromPath(slugRoot);
    if (fromSlugPath) {
      return fromSlugPath;
    }

    const cwdDiscovered = yield* Effect.promise(() => findProjectInAncestors(cwd));
    if (cwdDiscovered && (cwdDiscovered.name === projectSlug || cwdDiscovered.id === projectSlug)) {
      return cwdDiscovered.id;
    }

    const openedId = Option.getOrUndefined(lastOpened);
    if (openedId) {
      const openedRegistered = yield* findRegisteredProject(projectsRoot, openedId);
      if (
        openedRegistered &&
        (openedRegistered.name === projectSlug || openedRegistered.id === projectSlug)
      ) {
        return openedRegistered.id;
      }

      const openedFromCwd = yield* Effect.promise(() => findProjectInAncestors(cwd, openedId as ProjectId));
      if (openedFromCwd && (openedFromCwd.name === projectSlug || openedFromCwd.id === projectSlug)) {
        return openedFromCwd.id;
      }
    }

    return yield* Effect.fail(new CliUsageError({ message: `project not found: ${projectSlug}` }));
  });

export const resolveProjectId = (projectSlug: string | undefined) =>
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const home = yield* HomeService;
    const paths = yield* home.init();
    const cwd = process.cwd();
    const lastOpened = (yield* config.get).lastOpenedProject;

    if (projectSlug) {
      return yield* resolveExplicitProjectId(projectSlug, paths.projects, cwd, lastOpened);
    }

    const cwdProject = yield* Effect.promise(() => findProjectInAncestors(cwd));
    if (cwdProject) {
      return cwdProject.id;
    }

    const openedId = Option.getOrUndefined(lastOpened);
    if (!openedId) {
      return yield* Effect.fail(
        new CliUsageError({
          message: "project is required (pass --project, run from a project directory, or set lastOpenedProject in config)",
        }),
      );
    }

    const discovered = yield* Effect.promise(() => findProjectInAncestors(cwd, openedId as ProjectId));
    if (discovered) {
      return discovered.id;
    }

    const registered = yield* findRegisteredProject(paths.projects, openedId);
    if (registered) {
      return registered.id;
    }

    return yield* resolveExplicitProjectId(openedId, paths.projects, cwd, lastOpened);
  });

export const readMapIdArg = (args: Record<string, unknown>, key = "mapId"): MapId => {
  const positional = args["_"];
  const first = Array.isArray(positional) ? positional[0] : undefined;
  const value = args[key] ?? first;
  if (typeof value !== "string" || value.length === 0) {
    throw new CliUsageError({ message: "map id is required" });
  }
  return value as MapId;
};
