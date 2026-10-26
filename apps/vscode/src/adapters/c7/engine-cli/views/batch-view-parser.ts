import { Present } from "../present.js"
import { JsonObject } from "./json-object.js"
import type {
  BatchRef,
  BatchStatisticsView,
  BatchView,
  FailedJobView,
  HistoricBatchView,
} from "./views.js"

export class BatchViewParser {
  static reference(value: unknown): BatchRef {
    return { id: JsonObject.of(value, "batch").requiredString("id") }
  }

  static statistics(value: unknown): BatchStatisticsView | undefined {
    const [first] = JsonObject.listOf(value, "batch statistics")
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
    const record = JsonObject.of(value, "historic batch")
    return {
      ...BatchViewParser.batchOf(record),
      ...Present.fields({ endTime: record.optionalString("endTime") }),
    }
  }

  static failedJobs(value: unknown): FailedJobView[] {
    return JsonObject.listOf(value, "failed jobs").map((job) => ({
      id: job.requiredString("id"),
      ...Present.fields({ exceptionMessage: job.optionalString("exceptionMessage") }),
    }))
  }

  private static batchOf(record: JsonObject): BatchView {
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
