import type { ProjectId } from "@tileborne/core";
import type { MainTileborneBridge } from "./bridge-types.js";
import type { IpcClientOf, IpcHandlerAtChannel, IpcHandlersOf } from "./codegen-shape.js";
import type { RequestOf } from "./contract.js";
import { ProjectsGetContract, ProjectsIpcRegistry } from "./contracts/projects.js";
import { RuntimePlaytestInputContract } from "./contracts/runtime.js";

export type Assert<T extends true> = T;

export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;

export type IsNever<T> = [T] extends [never] ? true : false;

export type ProjectsGetClientRequest = Parameters<
  IpcClientOf<typeof ProjectsIpcRegistry>["tileborne:projects:get"]
>[0];
export type ProjectsGetHandlerRequest = Parameters<
  IpcHandlersOf<typeof ProjectsIpcRegistry>["tileborne:projects:get"]
>[0];

type ProjectsGetContractType = (typeof ProjectsIpcRegistry.byChannel)["tileborne:projects:get"];
export type ProjectsGetContractRequest = RequestOf<ProjectsGetContractType>;

export type DecodedProjectsGetRequest = (typeof ProjectsGetContract.request)["Type"];
export type EncodedProjectsGetRequest = (typeof ProjectsGetContract.request)["Encoded"];

export type ClientRequestIsDecoded = Assert<Equal<ProjectsGetClientRequest, DecodedProjectsGetRequest>>;
export type ClientRequestIsNotEncoded = Assert<
  Equal<Equal<ProjectsGetClientRequest, EncodedProjectsGetRequest>, false>
>;
export type ClientRequestIsNotNever = Assert<Equal<IsNever<ProjectsGetClientRequest>, false>>;
export type ClientProjectIdIsBranded = Assert<Equal<ProjectsGetClientRequest["projectId"], ProjectId>>;

export type HandlerRequestIsDecoded = Assert<Equal<ProjectsGetHandlerRequest, DecodedProjectsGetRequest>>;
export type ByChannelRequestIsDecoded = Assert<Equal<ProjectsGetContractRequest, DecodedProjectsGetRequest>>;

type ProjectsGetHandler = IpcHandlerAtChannel<typeof ProjectsIpcRegistry, "tileborne:projects:get">;
export type ProjectsGetHandlerAtChannelRequest = Parameters<ProjectsGetHandler>[0];
export type HandlerAtChannelRequestIsDecoded = Assert<
  Equal<ProjectsGetHandlerAtChannelRequest, DecodedProjectsGetRequest>
>;

// @ts-expect-error unknown channels are not generated on the client surface
export type UnknownClientChannel = IpcClientOf<typeof ProjectsIpcRegistry>["tileborne:projects:missing"];

declare type Bridge = MainTileborneBridge;

export type SystemPing = Bridge["system"]["ping"];
export type SystemPingRequest = Parameters<SystemPing>[0];
export type SystemPingResponse = Awaited<ReturnType<SystemPing>>;

export type SystemPingRequestIsEmpty = Assert<
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- ping request is Schema.Struct({})
  Equal<SystemPingRequest, {}>
>;
export type SystemPingResponseHasPong = Assert<Equal<SystemPingResponse["pong"], boolean>>;

export type LogsAppendedHandler = Parameters<Bridge["events"]["onLogsAppended"]>[0];
export type LogsAppendedPayload = Parameters<LogsAppendedHandler>[0];
export type LogsAppendedPayloadIsTriggerOnly = Assert<
  Equal<LogsAppendedPayload, import("./contracts/trigger.js").TriggerEventPayloadType>
>;

export type RuntimePlaytestInputRequest = (typeof RuntimePlaytestInputContract.request)["Type"];
export type RuntimePlaytestDirIsOptionalDirection = Assert<
  Equal<RuntimePlaytestInputRequest["dir"], 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | undefined>
>;
export type RuntimePlaytestAimDegIsOptionalInt = Assert<
  Equal<RuntimePlaytestInputRequest["aimDeg"], number | undefined>
>;
export type RuntimePlaytestWeaponSlotIsOptionalInt = Assert<
  Equal<RuntimePlaytestInputRequest["weaponSlot"], number | undefined>
>;
