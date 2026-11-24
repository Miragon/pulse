/**
 * The engine's migration plan (`POST /migration/generate`) and its report on a plan
 * (`POST /migration/validate`), each read through `JsonView`: an instruction names its source and
 * target activities, a report its instruction and what fails in it.
 */

import { RuntimeError } from "@miragon/pulse-engine-core"
import { JsonView } from "./json-view.js"

/** An instruction of a plan: the activities it maps from and to. */
export interface MigrationInstructionRow {
  readonly sourceActivityIds: readonly string[]
  readonly targetActivityIds: readonly string[]
}

/** A plan the engine generated. */
export interface MigrationPlanRow {
  readonly sourceProcessDefinitionId: string
  readonly targetProcessDefinitionId: string
  readonly instructions: readonly MigrationInstructionRow[]
}

/** What the engine reports of one instruction of a plan. */
export interface MigrationInstructionReportRow {
  readonly instruction: MigrationInstructionRow
  readonly failures: readonly string[]
}

function activityIds(record: JsonView, key: string): string[] {
  const ids = record.optionalStrings(key)
  if (ids === undefined) {
    throw new RuntimeError("unexpectedResponse", `${key} is missing`)
  }
  return ids
}

function instructionOf(record: JsonView): MigrationInstructionRow {
  return {
    sourceActivityIds: activityIds(record, "sourceActivityIds"),
    targetActivityIds: activityIds(record, "targetActivityIds"),
  }
}

/** The plan of a `generateMigrationPlan` answer. */
export function migrationPlanOf(answer: unknown): MigrationPlanRow {
  const record = JsonView.of(answer, "migration plan")
  return {
    sourceProcessDefinitionId: record.requiredString("sourceProcessDefinitionId"),
    targetProcessDefinitionId: record.requiredString("targetProcessDefinitionId"),
    instructions: record
      .optionalList("instructions")
      .map((instruction) => instructionOf(instruction)),
  }
}

/** The instruction reports of a `validateMigrationPlan` answer. */
export function instructionReportsOf(answer: unknown): MigrationInstructionReportRow[] {
  return JsonView.of(answer, "migration plan report")
    .optionalList("instructionReports")
    .map((report) => ({
      instruction: instructionOf(report.object("instruction", "instruction")),
      failures: report.optionalStrings("failures") ?? [],
    }))
}
