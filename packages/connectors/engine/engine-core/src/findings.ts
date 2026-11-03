/**
 * The findings of the status triage: pure rules over the aggregated status, each naming its next
 * step, and the overall status (the highest severity, else `ok`).
 */

import { formatDuration } from "./durations.js"
import { engineTime } from "./dates.js"
import { amount, compareText, field, type Rec, str } from "./records.js"
import type { GroupStep, IncidentGroup, JobStatus, TopicStatus } from "./status.js"
import { compact } from "./util.js"

export type Severity = "warning" | "critical"
export type EngineStatus = "ok" | Severity

/**
 * What to look at for a finding: the step of its incident group, the overdue jobs, the unlocked
 * tasks or the expired locks of a topic, the deployed definitions.
 */
export type FindingStep =
  | GroupStep
  | { readonly action: "listOverdueJobs" }
  | { readonly action: "listUnlockedTasks"; readonly topic: string }
  | { readonly action: "listExpiredLocks"; readonly topic: string }
  | { readonly action: "listDefinitions" }

/** `N`: the next step, structured (`FindingStep`) or the text a caller renders from it. */
export interface Finding<N = FindingStep> {
  readonly severity: Severity
  readonly code: string
  readonly message: string
  readonly next: N
}

export interface FindingInput {
  readonly jobs: JobStatus
  /** The incident groups shown; their findings carry the group's next step on. */
  readonly incidents: readonly IncidentGroup[]
  readonly externalTasks: readonly TopicStatus[]
  readonly batches: readonly Rec[]
  /** Named process definition keys without a deployed definition. */
  readonly unknownKeys?: readonly string[]
  readonly staleAfterMs: number
  readonly now: number
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

function overdueJobs(input: FindingInput): Finding[] {
  const { overdue, oldestReadySince } = input.jobs
  if (overdue === 0) return []
  const since = oldestReadySince === undefined ? "" : ` (oldest since ${oldestReadySince})`
  return [
    {
      severity: "critical",
      code: "JOBS_OVERDUE",
      message: `${plural(overdue, "executable job")} ${overdue === 1 ? "has" : "have"} waited longer than ${formatDuration(input.staleAfterMs)}${since}: is the job executor running?`,
      next: { action: "listOverdueJobs" },
    },
  ]
}

function where(group: IncidentGroup): string {
  return group.processDefinitionKey === ""
    ? `job definition ${group.jobDefinitionId ?? "(unknown)"}`
    : `${group.processDefinitionKey}/${group.activityId}`
}

function incidentFindings(input: FindingInput): Finding[] {
  return input.incidents.map((group): Finding => ({
    severity: "warning",
    code: "INCIDENTS",
    message: `${plural(group.count, `${group.type} incident`)} at ${where(group)}: ${group.rootCause ?? group.message}`,
    next: group.next,
  }))
}

function workerFindings(input: FindingInput): Finding[] {
  const threshold = input.now - input.staleAfterMs
  return input.externalTasks.flatMap((topic): Finding[] => {
    const findings: Finding[] = []
    const oldest = engineTime(topic.oldestWaitingSince)
    if (topic.waiting > 0 && topic.locked === 0 && oldest !== undefined && oldest < threshold) {
      findings.push({
        severity: "warning",
        code: "NO_WORKER",
        message: `topic ${topic.topic}: ${plural(topic.waiting, "task")} wait since ${topic.oldestWaitingSince ?? ""}, none is locked: is a worker subscribed?`,
        next: { action: "listUnlockedTasks", topic: topic.topic },
      })
    }
    const expired = engineTime(topic.oldestLockExpiredAt)
    if (topic.lockExpired > 0 && expired !== undefined && expired < threshold) {
      findings.push({
        severity: "warning",
        code: "LOCK_EXPIRED",
        message: `topic ${topic.topic}: ${plural(topic.lockExpired, "task")} with an expired lock (the oldest since ${topic.oldestLockExpiredAt ?? ""}): a worker crashed or exceeded its lock`,
        next: { action: "listExpiredLocks", topic: topic.topic },
      })
    }
    return findings
  })
}

function batchFindings(input: FindingInput): Finding[] {
  return input.batches.flatMap((batch): Finding[] => {
    const failed = amount(batch, "failedJobs")
    if (failed === 0) return []
    const jobDefinitionId = str(batch, "batchJobDefinitionId")
    return [
      {
        severity: "warning",
        code: "BATCH_FAILURES",
        message: `batch ${field(batch, "id")} (${field(batch, "type")}): ${plural(failed, "failed job")}`,
        next: { action: "listFailedJobs", ...compact({ jobDefinitionId }) },
      },
    ]
  })
}

function keyFindings(input: FindingInput): Finding[] {
  return (input.unknownKeys ?? []).map((key): Finding => ({
    severity: "warning",
    code: "UNKNOWN_KEY",
    message: `process definition key ${key} is not deployed`,
    next: { action: "listDefinitions" },
  }))
}

const SEVERITY_ORDER: readonly Severity[] = ["critical", "warning"]

/** Every finding, critical first, then by code and message; incident findings carry their group's step. */
export function findings(input: FindingInput): Finding[] {
  return [
    ...overdueJobs(input),
    ...incidentFindings(input),
    ...workerFindings(input),
    ...batchFindings(input),
    ...keyFindings(input),
  ].toSorted(
    (left, right) =>
      SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity) ||
      compareText(left.code, right.code) ||
      compareText(left.message, right.message),
  )
}

/** The highest severity of the findings, else `ok`. */
export function engineStatus(list: readonly Pick<Finding<unknown>, "severity">[]): EngineStatus {
  return list[0]?.severity ?? "ok"
}
