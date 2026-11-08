import type { Client } from "@miragon/pulse-engine-client"
import { EXECUTABLE, queryInput, toEngineDate, type Query } from "@miragon/pulse-engine-core"
import { enginePortFor } from "../lib/core-adapter/engine-port.js"
import type { JobBacklogData } from "../view-models.js"
import { countOf } from "./engine-reads.js"

/**
 * One engine's job backlog as four `/count` reads, every one primary: a count the engine did not
 * answer fails the feed, never a 0. The executable jobs are engine-core's `EXECUTABLE`, the rule
 * `engine_status` counts by, sent through the connector's engine port (its values are wire text).
 */
export async function buildJobBacklogData(
  client: Client,
): Promise<Omit<JobBacklogData, "engineId">> {
  const port = enginePortFor(client)
  const count = (operationId: string, query: Query) =>
    port.json(operationId, queryInput(query)).then(countOf)
  const [executableJobs, suspendedJobs, jobsDueLater, externalTasks] = await Promise.all([
    count("getJobsCount", EXECUTABLE),
    count("getJobsCount", { suspended: "true" }),
    count("getJobsCount", { dueDates: `gt_${toEngineDate(new Date())}` }),
    count("getExternalTasksCount", {}),
  ])
  return { executableJobs, suspendedJobs, jobsDueLater, externalTasks }
}
