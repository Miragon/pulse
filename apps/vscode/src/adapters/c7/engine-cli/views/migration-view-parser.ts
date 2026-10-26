import { EngineCliOutputError } from "../engine-cli-output-error.js"
import { JsonObject } from "./json-object.js"
import type {
  MigrationInstructionReportView,
  MigrationInstructionView,
  MigrationPlanView,
  MigrationReportView,
} from "./views.js"

export class MigrationViewParser {
  static plan(value: unknown): MigrationPlanView {
    const record = JsonObject.of(value, "migration plan")
    return {
      sourceProcessDefinitionId: record.requiredString("sourceProcessDefinitionId"),
      targetProcessDefinitionId: record.requiredString("targetProcessDefinitionId"),
      instructions: record
        .optionalList("instructions")
        .map((instruction) => MigrationViewParser.instruction(instruction)),
    }
  }

  static report(value: unknown): MigrationReportView {
    const record = JsonObject.of(value, "migration plan report")
    return {
      instructionReports: record
        .optionalList("instructionReports")
        .map((report) => MigrationViewParser.instructionReport(report)),
    }
  }

  private static instructionReport(record: JsonObject): MigrationInstructionReportView {
    return {
      instruction: MigrationViewParser.instruction(record.object("instruction", "instruction")),
      failures: record.optionalStrings("failures") ?? [],
    }
  }

  private static instruction(record: JsonObject): MigrationInstructionView {
    return {
      sourceActivityIds: MigrationViewParser.activityIds(record, "sourceActivityIds"),
      targetActivityIds: MigrationViewParser.activityIds(record, "targetActivityIds"),
    }
  }

  private static activityIds(record: JsonObject, key: string): string[] {
    const ids = record.optionalStrings(key)
    if (ids === undefined) {
      throw new EngineCliOutputError(`${key} is missing`)
    }
    return ids
  }
}
