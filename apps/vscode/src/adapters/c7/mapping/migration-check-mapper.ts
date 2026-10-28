import type { MigrationCheck, MigrationProblem } from "../../../contract/index.js"
import type { MigrationReportView } from "../engine-rest/index.js"
import type { Mapper } from "./mapper.js"
import { MigrationPlanMapper } from "./migration-plan-mapper.js"

export class MigrationCheckMapper implements Mapper<MigrationReportView, MigrationCheck> {
  map(report: MigrationReportView): MigrationCheck {
    return {
      problems: report.instructionReports.flatMap((instructionReport) => {
        const mapping = MigrationPlanMapper.mappingOf(instructionReport.instruction)
        return instructionReport.failures.map((message): MigrationProblem =>
          mapping === undefined ? { message } : { mapping, message },
        )
      }),
    }
  }
}
