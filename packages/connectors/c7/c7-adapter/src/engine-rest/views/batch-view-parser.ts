import { JsonView } from "@miragon/pulse-c7-core/runtime"
import { Present } from "../present.js"
import type {
  BatchRef,
  BatchStatisticsView,
  BatchView,
  FailedJobView,
  HistoricBatchView,
} from "./views.js"

export class BatchViewParser {
  static reference(value: unknown): BatchRef {
    return { id: JsonView.of(value, "batch").requiredString("id") }
  }

  static statistics(value: unknown): BatchStatisticsView | undefined {
    const [first] = JsonView.listOf(value, "batch statistics")
    if (first === undefined) {
      return undefined
    }
    return {
      ...BatchViewParser.batchOf(first),
      suspended: first.value("suspended") === true,
      completedJobs: first.requiredNumber("completedJobs"),
      failedJobs: first.requiredNumber("failedJobs"),
    }
  }

  static historic(value: unknown): HistoricBatchView {
    const record = JsonView.of(value, "historic batch")
    return {
      ...BatchViewParser.batchOf(record),
      ...Present.fields({ endTime: record.optionalString("endTime") }),
    }
  }

  static failedJobs(value: unknown): FailedJobView[] {
    return JsonView.listOf(value, "failed jobs").map((job) => ({
      id: job.requiredString("id"),
      ...Present.fields({ exceptionMessage: job.optionalString("exceptionMessage") }),
    }))
  }

  private static batchOf(record: JsonView): BatchView {
    return {
      id: record.requiredString("id"),
      type: record.requiredString("type"),
      totalJobs: record.requiredNumber("totalJobs"),
      invocationsPerBatchJob: record.optionalNumber("invocationsPerBatchJob") ?? 1,
      ...Present.fields({
        batchJobDefinitionId: record.optionalString("batchJobDefinitionId"),
        startTime: record.optionalString("startTime"),
      }),
    }
  }
}
