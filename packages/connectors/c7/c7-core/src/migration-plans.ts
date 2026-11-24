/**
 * Migration planning over the engine's port, the one home of its Camunda 7 rules: the definitions
 * of a process at a version number (`GET /process-definition`), the engine's plan between two
 * definitions (`POST /migration/generate`) and its check of a plan (`POST /migration/validate`),
 * both reads that change no event trigger, and the instruction body of a plan, one source
 * activity to one target activity. The CLI writes a plan file over these rules, the contract's
 * `MigrationReader` reads through them. Each answer is read through `JsonView`: the exported
 * functions fail an answer they cannot read as the `WorkflowError` reason `unexpected-answer`,
 * as the main entry fails what its caller words, while `readProposal` and `readProblems` keep the
 * contract's `RuntimeError("unexpectedResponse")` for `MigrationReader`.
 */

import { RuntimeError } from "@miragon/pulse-engine-core"
import { WorkflowError } from "./errors.js"
import { JsonView } from "./json-view.js"
import {
  instructionReportsOf,
  type MigrationInstructionRow,
  migrationPlanOf,
} from "./migration-rows.js"
import { type EnginePort, type PlannedRequest, pageQuery, type Query } from "./port.js"
import type { Rec } from "./records.js"

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

/** The definitions a version lookup reads at most: one more tells that there are more. */
const DEFINITIONS_CAP = 10

function versionQuery(key: string, version: VersionQuery): Query {
  return version === "latest" ? { key, latestVersion: "true" } : { key, version: String(version) }
}

function definitionOf(row: Rec): DefinitionAtVersion {
  const definition = JsonView.of(row, "process definition")
  const tenantId = definition.optionalString("tenantId")
  return {
    id: definition.requiredString("id"),
    version: definition.requiredNumber("version"),
    ...(tenantId === undefined ? {} : { tenantId }),
  }
}

/** What `read` answers; an answer it cannot read fails as the reason `unexpected-answer`. */
async function readable<T>(operationId: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (error instanceof RuntimeError && error.failure === "unexpectedResponse") {
      throw new WorkflowError({ kind: "unexpected-answer", operationId, problem: error.message })
    }
    throw error
  }
}

/** The request `definitionsAtVersion` sends first. */
export function definitionsAtVersionRequest(key: string, version: VersionQuery): PlannedRequest {
  return {
    operationId: "getProcessDefinitions",
    input: { pathArgs: [], query: pageQuery(versionQuery(key, version), 0, DEFINITIONS_CAP + 1) },
  }
}

/** The definitions of the process `key` at `version`, every tenant's, at most 10 of them. */
export function definitionsAtVersion(
  port: EnginePort,
  key: string,
  version: VersionQuery,
): Promise<DefinitionsAtVersion> {
  return readable("getProcessDefinitions", async () => {
    const query = versionQuery(key, version)
    const { items, truncated } = await port.list("getProcessDefinitions", query, DEFINITIONS_CAP)
    return { definitions: items.map(definitionOf), more: truncated }
  })
}

/** The instructions of a plan's mappings, one each. */
export function migrationInstructions(mappings: readonly ElementPair[]): MigrationInstruction[] {
  return mappings.map((mapping): MigrationInstruction => ({
    sourceActivityIds: [mapping.sourceElementId],
    targetActivityIds: [mapping.targetElementId],
    updateEventTrigger: false,
  }))
}

/** The pair an instruction maps: one source and one target activity, else none. */
export function elementPairOf(instruction: MigrationInstructionRow): ElementPair | undefined {
  const [source, ...otherSources] = instruction.sourceActivityIds
  const [target, ...otherTargets] = instruction.targetActivityIds
  if (
    source === undefined ||
    target === undefined ||
    otherSources.length + otherTargets.length > 0
  ) {
    return undefined
  }
  return { sourceElementId: source, targetElementId: target }
}

/** `proposeMigrationPlan`, failing an answer it cannot read as `RuntimeError("unexpectedResponse")`. */
export async function readProposal(
  port: EnginePort,
  sourceDefinitionId: string,
  targetDefinitionId: string,
): Promise<ProposedMigrationPlan> {
  const answer = await port.json("generateMigrationPlan", {
    pathArgs: [],
    query: {},
    body: {
      sourceProcessDefinitionId: sourceDefinitionId,
      targetProcessDefinitionId: targetDefinitionId,
      updateEventTriggers: false,
    },
  })
  const plan = migrationPlanOf(answer)
  const mappings = plan.instructions.flatMap((instruction) => elementPairOf(instruction) ?? [])
  return {
    sourceDefinitionId: plan.sourceProcessDefinitionId,
    targetDefinitionId: plan.targetProcessDefinitionId,
    mappings,
    leftOut: plan.instructions.length - mappings.length,
  }
}

/** `checkMigrationPlan`, failing an answer it cannot read as `RuntimeError("unexpectedResponse")`. */
export async function readProblems(
  port: EnginePort,
  plan: PlannedMigration,
): Promise<PlanCheckProblem[]> {
  const answer = await port.json("validateMigrationPlan", {
    pathArgs: [],
    query: {},
    body: {
      sourceProcessDefinitionId: plan.sourceDefinitionId,
      targetProcessDefinitionId: plan.targetDefinitionId,
      instructions: migrationInstructions(plan.mappings),
    },
  })
  return instructionReportsOf(answer).flatMap((report) => {
    const mapping = elementPairOf(report.instruction)
    return report.failures.map((message): PlanCheckProblem =>
      mapping === undefined ? { message } : { mapping, message },
    )
  })
}

/** The plan the engine proposes between two definitions, its one to one mappings. */
export function proposeMigrationPlan(
  port: EnginePort,
  sourceDefinitionId: string,
  targetDefinitionId: string,
): Promise<ProposedMigrationPlan> {
  return readable("generateMigrationPlan", () =>
    readProposal(port, sourceDefinitionId, targetDefinitionId),
  )
}

/** What the engine finds wrong with `plan`, each problem with its mapping where it names one. */
export function checkMigrationPlan(
  port: EnginePort,
  plan: PlannedMigration,
): Promise<PlanCheckProblem[]> {
  return readable("validateMigrationPlan", () => readProblems(port, plan))
}
