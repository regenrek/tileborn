import path from "node:path";
import { Schema } from "effect";

import { ContentHash } from "@tileborne/core";
import { PluginSource } from "@tileborne/services-plugin";

import { CliUsageError } from "../render/errors.js";

const NPM_SPEC = /^(@[^/]+\/[^@]+|[^/@]+)(?:@(.+))?$/;

export interface PluginInstallArgs {
  readonly spec?: string | undefined;
  readonly local?: string | undefined;
  readonly tarball?: string | undefined;
  readonly integrity?: string | undefined;
  readonly git?: string | undefined;
  readonly ref?: string | undefined;
  readonly devSymlink?: string | undefined;
}

export const decodePluginSource = (input: unknown): PluginSource => {
  try {
    return Schema.decodeUnknownSync(PluginSource)(input);
  } catch (cause) {
    throw new CliUsageError({
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
};

export const parseNpmPluginSpec = (spec: string): PluginSource => {
  const match = NPM_SPEC.exec(spec.trim());
  if (!match) {
    throw new CliUsageError({ message: `invalid plugin spec: ${spec}` });
  }
  const packageName = match[1] as string;
  const version = match[2];
  return decodePluginSource({
    _tag: "npm",
    packageName,
    version: version && version.length > 0 ? version : undefined,
  });
};

export const resolvePluginInstallSource = (args: PluginInstallArgs): PluginSource => {
  const flags = [args.local, args.tarball, args.git, args.devSymlink].filter(Boolean);
  if (flags.length > 1) {
    throw new CliUsageError({ message: "plugin install accepts only one source flag at a time" });
  }
  if (args.local) {
    return decodePluginSource({ _tag: "local", path: path.resolve(args.local) });
  }
  if (args.devSymlink) {
    return decodePluginSource({ _tag: "dev-symlink", linkPath: path.resolve(args.devSymlink) });
  }
  if (args.tarball) {
    const resolved = path.resolve(args.tarball);
    const url = path.isAbsolute(resolved) ? resolved : args.tarball;
    return decodePluginSource({
      _tag: "tarball",
      url,
      integrity:
        args.integrity && args.integrity.length > 0
          ? Schema.decodeUnknownSync(ContentHash)(args.integrity)
          : undefined,
    });
  }
  if (args.git) {
    return decodePluginSource({
      _tag: "git",
      repo: args.git,
      ref: args.ref && args.ref.length > 0 ? args.ref : undefined,
    });
  }
  if (args.spec) {
    return parseNpmPluginSpec(args.spec);
  }
  throw new CliUsageError({
    message: "plugin install requires <spec> or one of --local, --tarball, --git, --dev-symlink",
  });
};
