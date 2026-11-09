import {
  listJobsInput,
  getJobStacktraceInput,
  setJobRetriesInput,
  setJobRetriesBatchInput,
} from "../schemas/index.js"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { fetchJobStacktrace, queuedBatch } from "@miragon/pulse-c7-client"
import { complementaryFlags, engineSorting, toOptionalEngineDate } from "@miragon/pulse-c7-core"
import {
  getJobs,
  getJobsCount,
  setJobRetries,
  setJobRetriesAsyncOperation,
} from "@miragon/pulse-c7-client/sdk"
import { paginatedListOutput, toPaginatedList } from "../lib/mcp/pagination.js"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/engine/with-engine.js"
import { boundFailureText, condenseStacktrace } from "../lib/mcp/failure-text.js"
import { noneIfMissing } from "../lib/core-adapter/engine-port.js"

export function registerJobTools(register: ToolRegistrar<EngineRegistry>) {
  register({
    name: "engine_list_jobs",
    category: "jobs",
    description: "List jobs (timers, async continuations).",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...listJobsInput.shape, ...engineParamShape },
    outputSchema: paginatedListOutput,
    handler: withEngine(async (client, args) => {
      const filters = {
        processInstanceId: args.processInstanceId,
        processDefinitionKey: args.processDefinitionKey,
        activityId: args.activityId,
        ...complementaryFlags(args, "withRetriesLeft", "noRetriesLeft"),
        ...complementaryFlags(args, "active", "suspended"),
      }
      const [items, count] = await Promise.all([
        getJobs({
          client,
          query: {
            ...filters,
            firstResult: args.firstResult,
            maxResults: args.maxResults,
            ...engineSorting(args),
          },
        }),
        getJobsCount({ client, query: filters }),
      ])
      return toPaginatedList(items, count, args.firstResult)
    }),
  })

  register({
    name: "engine_get_job_stacktrace",
    category: "jobs",
    description:
      "Get the exception stacktrace of a failed job, condensed to the exception lines, the Caused-by " +
      "chain and user-code frames (framework frames trimmed). stacktrace is null when the job has " +
      "none or no longer exists.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...getJobStacktraceInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      const raw = await noneIfMissing(fetchJobStacktrace(client, args.jobId))
      return {
        jobId: args.jobId,
        stacktrace: raw ? boundFailureText(condenseStacktrace(raw)) : null,
      }
    }),
  })

  register({
    name: "engine_set_job_retries",
    category: "jobs",
    description:
      "Set the number of retries for a failed job. Setting retries > 0 will re-execute the job.",
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...setJobRetriesInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      await setJobRetries({
        client,
        path: { id: args.jobId },
        body: { retries: args.retries },
      })
      return { success: true, jobId: args.jobId, retries: args.retries }
    }),
  })

  register({
    name: "engine_set_job_retries_batch",
    category: "jobs",
    description:
      'Queue a batch that sets retries on multiple jobs. Returns { batchId, status: "queued" }, not the outcome: ' +
      "follow it with engine_get_batch.",
    annotations: { destructiveHint: true, openWorldHint: true },
    inputSchema: { ...setJobRetriesBatchInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      const batch = await setJobRetriesAsyncOperation({
        client,
        body: {
          jobIds: args.jobIds,
          retries: args.retries,
          dueDate: toOptionalEngineDate(args.dueDate),
        },
      })
      return { ...queuedBatch(batch), jobCount: args.jobIds.length, retries: args.retries }
    }),
  })
}
