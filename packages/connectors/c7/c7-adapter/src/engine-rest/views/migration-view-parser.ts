import { JsonView } from "@miragon/pulse-c7-core/runtime"
import { UnexpectedAnswerError } from "./unexpected-answer-error.js"
import type {
  MigrationInstructionReportView,
  MigrationInstructionView,
  MigrationPlanView,
  MigrationReportView,
} from "./views.js"

export class MigrationViewParser {
  static plan(value: unknown): MigrationPlanView {
    const record = JsonView.of(value, "migration plan")
    return {
      sourceProcessDefinitionId: record.requiredString("sourceProcessDefinitionId"),
      targetProcessDefinitionId: record.requiredString("targetProcessDefinitionId"),
      instructions: record
        .optionalList("instructions")
        .map((instruction) => MigrationViewParser.instruction(instruction)),
    }
  }

  static report(value: unknown): MigrationReportView {
    const record = JsonView.of(value, "migration plan report")
    return {
      instructionReports: record
        .optionalList("instructionReports")
        .map((report) => MigrationViewParser.instructionReport(report)),
    }
  }

  private static instructionReport(record: JsonView): MigrationInstructionReportView {
    return {
      instruction: MigrationViewParser.instruction(record.object("instruction", "instruction")),
      failures: record.optionalStrings("failures") ?? [],
    }
  }

  private static instruction(record: JsonView): MigrationInstructionView {
    return {
      sourceActivityIds: MigrationViewParser.activityIds(record, "sourceActivityIds"),
      targetActivityIds: MigrationViewParser.activityIds(record, "targetActivityIds"),
    }
  }

  private static activityIds(record: JsonView, key: string): string[] {
    const ids = record.optionalStrings(key)
    if (ids === undefined) {
      throw new UnexpectedAnswerError(`${key} is missing`)
    }
    return ids
  }
}
