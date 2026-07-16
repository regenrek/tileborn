import { Schema } from 'effect';

/** Permission declarations are order-insensitive; hosts should dedupe by tag + payload. */
export class ReadAssetPack extends Schema.TaggedClass<ReadAssetPack>()('ReadAssetPack', {
  packId: Schema.OptionFromUndefinedOr(Schema.String),
}) {}

export class RegisterRuntimeSystem extends Schema.TaggedClass<RegisterRuntimeSystem>()(
  'RegisterRuntimeSystem',
  {
    systemId: Schema.OptionFromUndefinedOr(Schema.String),
  },
) {}

export class RegisterEditorTool extends Schema.TaggedClass<RegisterEditorTool>()(
  'RegisterEditorTool',
  {
    toolId: Schema.OptionFromUndefinedOr(Schema.String),
  },
) {}

export class RegisterServerRule extends Schema.TaggedClass<RegisterServerRule>()(
  'RegisterServerRule',
  {
    ruleId: Schema.OptionFromUndefinedOr(Schema.String),
  },
) {}

export class NetworkAccess extends Schema.TaggedClass<NetworkAccess>()('NetworkAccess', {
  hosts: Schema.Array(Schema.String),
}) {}

export class FilesystemRead extends Schema.TaggedClass<FilesystemRead>()('FilesystemRead', {
  paths: Schema.Array(Schema.String),
}) {}

export class FilesystemWrite extends Schema.TaggedClass<FilesystemWrite>()('FilesystemWrite', {
  paths: Schema.Array(Schema.String),
}) {}

export class ValidateMap extends Schema.TaggedClass<ValidateMap>()('ValidateMap', {
  profile: Schema.OptionFromUndefinedOr(Schema.String),
}) {}

export class ExportArtifact extends Schema.TaggedClass<ExportArtifact>()('ExportArtifact', {
  formats: Schema.Array(Schema.String),
}) {}

export class GenerateMap extends Schema.TaggedClass<GenerateMap>()('GenerateMap', {
  generatorId: Schema.OptionFromUndefinedOr(Schema.String),
}) {}

export class ImportAsset extends Schema.TaggedClass<ImportAsset>()('ImportAsset', {
  kinds: Schema.Array(Schema.String),
}) {}

export class PostProcessAssetPack extends Schema.TaggedClass<PostProcessAssetPack>()(
  'PostProcessAssetPack',
  {
    processorId: Schema.OptionFromUndefinedOr(Schema.String),
  },
) {}

export const PluginPermission = Schema.Union([
  ReadAssetPack,
  RegisterRuntimeSystem,
  RegisterEditorTool,
  RegisterServerRule,
  NetworkAccess,
  FilesystemRead,
  FilesystemWrite,
  ValidateMap,
  ExportArtifact,
  GenerateMap,
  ImportAsset,
  PostProcessAssetPack,
]);

export type PluginPermission = typeof PluginPermission.Type;
