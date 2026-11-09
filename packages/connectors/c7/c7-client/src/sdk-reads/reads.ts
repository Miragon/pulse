/**
 * Engine reads whose REST contract differs from the client defaults, the
 * ONE place `tools/` and `data/` take them from, so no call site can forget
 * the override:
 *
 * - Text endpoints (`/job/{id}/stacktrace`, `/external-task/{id}/errorDetails`)
 *   produce ONLY `text/plain` and answer the client's default
 *   `Accept: application/json` with a 406 before the resource runs.
 * - Runtime variable reads default to `deserializeValues=true`: the engine
 *   then deserializes every Object variable eagerly (one class missing on its
 *   classpath fails the WHOLE read with a 500) and renders Json variables as
 *   Jackson's view of the Spin node instead of their JSON. With `false`,
 *   Object/Json/Xml values come back as their serialized string + `valueInfo`,
 *   exactly the shape a variable write takes back.
 *
 * These reads never decide what a failure means: every engine error throws
 * (as the client's error interceptor words it), a 404 included. Whether a 404 names a missing
 * resource or a wrong REST root is c7-core's `isMissing`, the one rule of
 * the family; the caller reads the error through it (the engine connector's
 * port and tools).
 */
import type { Client } from "../generated/client/types.gen.js"
import {
  getBatchStatistics,
  getExternalTaskErrorDetails,
  getHistoricBatch,
  getProcessInstanceVariables,
  getStacktrace,
  getTaskVariables,
} from "../generated/sdk.gen.js"
import type { VariableValueDto } from "../generated/types.gen.js"
import { endedBatchReport, runningBatchReport, type BatchReport } from "./batches.js"

/** Request options for a `text/plain`-only endpoint. */
const TEXT_PLAIN = { parseAs: "text", headers: { Accept: "text/plain" } } as const

/**
 * The query the variable reads send. The rule's home is c7-core's `RAW_VARIABLES`; this leaf
 * does not import c7-core, so its two SDK reads restate the flag, and the engine connector
 * (the one package that imports both) holds the copy equal to c7-core's in
 * `src/sdk-reads.test.ts`.
 */
const RAW_VARIABLES = { deserializeValues: false } as const

export type VariableMap = Record<string, VariableValueDto>

/** Engine text, `null` for an empty body (204, or a resource without one). */
function textOrNull(text: unknown): string | null {
  return typeof text === "string" && text.length > 0 ? text : null
}

/**
 * The exception stacktrace of a job; `null` when the job has none (an empty
 * body). Every failure throws, a 404 included: the caller decides through
 * c7-core's `isMissing` whether the job is gone or the REST root wrong.
 */
export async function fetchJobStacktrace(client: Client, jobId: string): Promise<string | null> {
  return textOrNull(await getStacktrace({ client, path: { id: jobId }, ...TEXT_PLAIN }))
}

/**
 * The error details a worker reported for an external task (its
 * `failedExternalTask` stacktrace); `null` when there are none (an empty
 * body). Every failure throws, a 404 included (see `fetchJobStacktrace`).
 */
export async function fetchExternalTaskErrorDetails(
  client: Client,
  externalTaskId: string,
): Promise<string | null> {
  return textOrNull(
    await getExternalTaskErrorDetails({ client, path: { id: externalTaskId }, ...TEXT_PLAIN }),
  )
}

/** All variables of a process instance, serialized (see the module doc). */
export function readProcessInstanceVariables(
  client: Client,
  processInstanceId: string,
): Promise<VariableMap> {
  return getProcessInstanceVariables({
    client,
    path: { id: processInstanceId },
    query: RAW_VARIABLES,
  })
}

/** All variables visible from a task, serialized (see the module doc). */
export function readTaskVariables(client: Client, taskId: string): Promise<VariableMap> {
  return getTaskVariables({ client, path: { id: taskId }, query: RAW_VARIABLES })
}

/**
 * Where a batch stands: the runtime statistics while it exists (counts incl.
 * failed batch jobs), its history record once it ended. A batch neither
 * holds fails with the engine's error of the history read (a 404 when it
 * never existed, or ended on an engine without batch history); the caller
 * words it through c7-core's `isMissing`.
 */
export async function readBatch(client: Client, batchId: string): Promise<BatchReport> {
  const running = await getBatchStatistics({ client, query: { batchId } })
  if (Array.isArray(running) && running[0]) return runningBatchReport(running[0])
  return endedBatchReport(await getHistoricBatch({ client, path: { id: batchId } }))
}
