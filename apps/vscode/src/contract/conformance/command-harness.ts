import type { DefinitionId, InstanceId } from "../model/ids.js"
import type { ProcessCommands } from "../ports/process-commands.js"
import type { ProcessRuntime } from "../ports/process-runtime.js"
import type { UnknownIds } from "./harness.js"
import type { BulkSet, CommandInstanceAlias, DeploymentAlias, MigrationSet } from "./world/world.js"

export interface CommandWorld {
  readonly instanceIds: Readonly<Record<CommandInstanceAlias, InstanceId>>
  readonly bulkInstanceIds: Readonly<Record<BulkSet, readonly InstanceId[]>>
  readonly migrationInstanceIds: Readonly<Record<MigrationSet, readonly InstanceId[]>>
  readonly definitionIds: Readonly<Record<DeploymentAlias, DefinitionId>>
  readonly unknown: UnknownIds
}

export interface WriteVisibility {
  readonly withinMs: number
  wait(ms: number): Promise<void>
}

export interface CommandHarness {
  readonly runtime: ProcessRuntime
  readonly commands: ProcessCommands
  readonly world: CommandWorld
  readonly writeVisibility?: WriteVisibility
  readonly asyncWork?: WriteVisibility
}

export type PrepareCommandHarness = () => Promise<CommandHarness>

export interface CommandConformanceCase {
  readonly name: string
  run(harness: CommandHarness): Promise<void>
}

export const COMMAND_CASE = {
  retryClosesIncident: "commands: retrying an incident closes exactly that incident",
  retryRejected: "commands: retrying an unknown or already closed incident is rejected",
  variableReadsBack: "commands: a changed variable reads back with its new value and kind",
  variableLossless: "commands: large integers and JSON structures survive a change",
  variableRejected: "commands: changing a variable of an unknown or ended instance is rejected",
  moveSkips:
    "commands: a moved token waits at its target, its source and its incident are gone and the instance runs on",
  moveReruns:
    "commands: a token moved onto its own element runs that element again instead of the old run",
  moveRejected:
    "commands: a move in an unknown or ended instance, without a reason, from an element without a token or with several tokens is rejected and changes nothing",
  bulkCancelEndsExactly:
    "bulk: cancelling instances ends exactly those instances and the operation reports its progress",
  bulkSkipsEnded: "bulk: instances that already ended are left alone and not counted as failed",
  bulkStopHalts: "bulk: a stopped operation stops running and soon cancels nothing more",
  bulkUnknown: "bulk: an unknown operation is undefined and stopping it is rejected",
  migrationMovesExactly:
    "migration: migrating instances with the proposal moves exactly those to the target, at the same elements, incidents included",
  migrationReportsFailures:
    "migration: instances at an element without a mapping stay on the source and the operation names why",
  migrationSkipsEnded:
    "migration: instances that already ended are left alone and not counted as failed, and nothing left is rejected",
} as const

export type CommandCaseName = (typeof COMMAND_CASE)[keyof typeof COMMAND_CASE]
