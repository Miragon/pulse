/**
 * Migration planning over the engine's port, the one home of its Camunda 7 rules: the definitions
 * of a process at a version number (`GET /process-definition`), the engine's plan between two
 * definitions (`POST /migration/generate`) and its check of a plan (`POST /migration/validate`),
 * both reads that change no event trigger, and the instruction body of a plan, one source
 * activity to one target activity. The CLI writes a plan file over these rules, the contract's
 * `MigrationReader` reads through them.
 */

import type { EnginePort, PlannedRequest } from "./port.js"

/** One element of the source version mapped onto one element of the target version. */
export interface ElementPair {
  readonly sourceElementId: string
  readonly targetElementId: string
}

/** An instruction of a plan the engine reads: one source activity to one target activity. */
export interface MigrationInstruction {
  readonly sourceActivityIds: readonly [string]
  readonly targetActivityIds: readonly [string]
  readonly updateEventTrigger: false
}

/** A plan between two definitions, by their ids. */
export interface PlannedMigration {
  readonly sourceDefinitionId: string
  readonly targetDefinitionId: string
  readonly mappings: readonly ElementPair[]
}

/** The plan the engine proposes. */
export interface ProposedMigrationPlan extends PlannedMigration {
  /** Engine instructions that are not one source to one target. */
  readonly leftOut: number
}

/** What the engine finds wrong with a plan, with its mapping where it names one. */
export interface PlanCheckProblem {
  readonly mapping?: ElementPair
  readonly message: string
}

/** A definition of a process at a version number. */
export interface DefinitionAtVersion {
  readonly id: string
  readonly version: number
  readonly tenantId?: string
}

/** The definitions at a version number, at most a page of them; `more` when the page was cut. */
export interface DefinitionsAtVersion {
  readonly definitions: readonly DefinitionAtVersion[]
  readonly more: boolean
}

/** A version number, or the latest version of a process. */
export type VersionQuery = number | "latest"

function unplanned(name: string, ...inputs: readonly unknown[]): never {
  throw new Error(`${name} has no body (${String(inputs.length)} arguments)`)
}

/** The request `definitionsAtVersion` sends first. */
export function definitionsAtVersionRequest(key: string, version: VersionQuery): PlannedRequest {
  return unplanned("definitionsAtVersionRequest", key, version)
}

/** The definitions of the process `key` at `version`. */
export function definitionsAtVersion(
  port: EnginePort,
  key: string,
  version: VersionQuery,
): Promise<DefinitionsAtVersion> {
  return unplanned("definitionsAtVersion", port, key, version)
}

/** The instructions of a plan's mappings, one each. */
export function migrationInstructions(mappings: readonly ElementPair[]): MigrationInstruction[] {
  return unplanned("migrationInstructions", mappings)
}

/** The plan the engine proposes between two definitions, its one to one mappings. */
export function proposeMigrationPlan(
  port: EnginePort,
  sourceDefinitionId: string,
  targetDefinitionId: string,
): Promise<ProposedMigrationPlan> {
  return unplanned("proposeMigrationPlan", port, sourceDefinitionId, targetDefinitionId)
}

/** What the engine finds wrong with `plan`. */
export function checkMigrationPlan(
  port: EnginePort,
  plan: PlannedMigration,
): Promise<PlanCheckProblem[]> {
  return unplanned("checkMigrationPlan", port, plan)
}
