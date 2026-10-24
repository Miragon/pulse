/**
 * `pulse-cli wait --batch <id>`: polls the batch statistics until the batch is gone
 * (finished or deleted), and fails fast when its failed jobs keep it from finishing.
 */

import type { EnginePort, PlannedRequest } from "../engine-port/engine-port.js"
import { OperateError } from "../errors.js"
import { formatDuration } from "../operation/durations.js"
import { compact } from "../util.js"
import { json, queryInput } from "./engine.js"
import { poll } from "./poll.js"
import { amount, field, num, type Rec, records, str } from "./records.js"
import type { Waited, WorkflowResult } from "./types.js"
import { type WaitDeps, waitingNotice } from "./wait.js"

interface BatchSummary {
  readonly id: string
  readonly type: string
  readonly totalJobs: number
  readonly failedJobs?: number
  readonly startTime?: string
  readonly endTime?: string
}

export interface BatchView {
  readonly batch: BatchSummary
  readonly waited?: Waited
}

type BatchEnd = { readonly kind: "finished"; readonly history?: Rec } | { readonly kind: "stuck" }

/** Failed jobs listed by JOB_FAILED. */
const LISTED_FAILURES = 5

export function batchRequests(batchId: string): PlannedRequest[] {
  return [{ operationId: "getBatchStatistics", input: queryInput({ batchId }) }]
}

function summary(
  batchId: string,
  statistics: Rec | undefined,
  history: Rec | undefined,
): BatchSummary {
  const failed = amount(statistics, "failedJobs")
  return {
    id: str(history, "id") ?? str(statistics, "id") ?? batchId,
    type: str(history, "type") ?? field(statistics, "type"),
    totalJobs: num(history, "totalJobs") ?? amount(statistics, "totalJobs"),
    ...compact({
      failedJobs: failed > 0 ? failed : undefined,
      startTime: str(history, "startTime") ?? str(statistics, "startTime"),
      endTime: str(history, "endTime"),
    }),
  }
}

/** Every job was created, and only failed jobs remain: the batch cannot finish. */
function isStuck(statistics: Rec): boolean {
  const failed = amount(statistics, "failedJobs")
  return (
    failed > 0 &&
    num(statistics, "jobsCreated") === num(statistics, "totalJobs") &&
    num(statistics, "remainingJobs") === failed
  )
}

async function stuckError(
  port: EnginePort,
  batch: BatchSummary,
  statistics: Rec,
): Promise<OperateError> {
  const jobDefinitionId = str(statistics, "batchJobDefinitionId")
  const jobs =
    jobDefinitionId === undefined
      ? []
      : records(
          await json(
            port,
            "getJobs",
            queryInput({
              jobDefinitionId,
              withException: "true",
              maxResults: String(LISTED_FAILURES),
            }),
          ),
        )
  const failures = jobs.map((job) =>
    compact({ jobId: str(job, "id"), exceptionMessage: str(job, "exceptionMessage") }),
  )
  const first = failures[0]?.exceptionMessage
  return new OperateError(
    "JOB_FAILED",
    `Batch ${batch.id} cannot finish: ${batch.failedJobs ?? 0} jobs failed${first === undefined ? "" : `, the first: ${first}`}`,
    {
      hint: `\`pulse-cli job list --job-definition-id ${jobDefinitionId ?? "<id>"} --with-exception\` lists the failed jobs; fix the cause, then set their retries (\`pulse-cli job set-retries <id> --retries 1\`).`,
      data: { batchId: batch.id, failedJobs: batch.failedJobs ?? 0, failures },
    },
  )
}

/** Waits until the batch finished; WAIT_TIMEOUT, JOB_FAILED and NOT_FOUND as documented. */
export async function waitForBatch(
  deps: WaitDeps,
  batchId: string,
  timeoutMs: number,
): Promise<WorkflowResult<BatchView>> {
  const { port } = deps
  let last: Rec | undefined
  const result = await poll<BatchEnd>(
    async () => {
      const statistics = records(await json(port, "getBatchStatistics", queryInput({ batchId })))[0]
      if (statistics !== undefined) {
        last = statistics
        return isStuck(statistics) ? { kind: "stuck" } : undefined
      }
      const history = records([
        await port.find("getHistoricBatch", { pathArgs: [batchId], query: {} }),
      ])[0]
      if (history === undefined && last === undefined) {
        throw new OperateError("NOT_FOUND", `Batch ${batchId} does not exist`, {
          hint: "List batches with `pulse-cli batch list` (running) or `pulse-cli historic-batch list` (also finished).",
        })
      }
      return { kind: "finished", ...compact({ history }) }
    },
    {
      now: deps.now,
      sleep: deps.sleep,
      timeoutMs,
      waiting: () => deps.notice?.(waitingNotice(`batch ${batchId} finished`, timeoutMs)),
    },
  )
  const end = result.value
  if (end?.kind === "finished") {
    const batch = summary(batchId, last, end.history)
    return {
      kind: "view",
      view: {
        batch,
        waited: { until: "finished", elapsedMs: result.elapsedMs, polls: result.polls },
      },
    }
  }
  const batch = summary(batchId, last, undefined)
  if (end?.kind === "stuck" && last !== undefined) {
    return { kind: "view", view: { batch }, failure: await stuckError(port, batch, last) }
  }
  const failure = new OperateError(
    "WAIT_TIMEOUT",
    `Timed out after ${formatDuration(timeoutMs)} waiting until batch ${batchId} finished`,
    {
      hint: "The batch jobs and its monitor job run on the job executor (the monitor checks every 30 s by default); raise --wait-timeout, or run `pulse-cli status` to see overdue jobs.",
      data: { until: ["finished"], elapsedMs: result.elapsedMs, polls: result.polls, batch },
    },
  )
  return { kind: "view", view: { batch }, failure }
}
