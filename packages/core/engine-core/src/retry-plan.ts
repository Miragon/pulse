/**
 * Planning of retry: the selection mode, the root cause incidents to retry and the requests per
 * incident type. Pure.
 */

import { WorkflowError } from "./errors.js"
import type { PlannedWrite } from "./port.js"
import { compareText, compareTime, field, type Rec, str } from "./records.js"
import type { Selection } from "./types.js"
import { compact } from "./util.js"

export type RetryMode = "instance" | "incidents" | "definition"

/** More retryable incidents than this are pointed to the asynchronous bulk operations. */
const MAX_RETRIES = 1000

/** The selection mode: exactly one of instance, incidents and definition. */
export function retryMode(selection: Selection, incidentIds: readonly string[]): RetryMode {
  const instance =
    selection.id !== undefined || selection.businessKey !== undefined || selection.latest
  if (incidentIds.length > 0) {
    if (instance || selection.processDefinitionKey !== undefined) {
      throw new WorkflowError({ kind: "retry-selection-conflict" })
    }
    return "incidents"
  }
  if (instance) return "instance"
  if (selection.processDefinitionKey !== undefined) return "definition"
  throw new WorkflowError({ kind: "retry-selection-missing" })
}

/** Retrying every incident of a definition is a bulk operation. */
export function retryEffect(mode: RetryMode): "write" | "bulk" {
  return mode === "definition" ? "bulk" : "write"
}

/** A root cause incident and what retry does about it. */
export interface PlanEntry {
  readonly incidentId: string
  readonly type: string
  readonly activityId: string
  readonly processInstanceId: string
  readonly message?: string
  readonly jobId?: string
  readonly externalTaskId?: string
  /** `job`, `externalTask`, or `skip` for incident types retry cannot fix. */
  readonly action: "job" | "externalTask" | "skip"
}

function isRoot(incident: Rec): boolean {
  return str(incident, "id") === str(incident, "rootCauseIncidentId")
}

/** Root cause ids of propagated incidents that were not loaded. */
export function missingRoots(incidents: readonly Rec[]): string[] {
  const loaded = new Set(incidents.map((incident) => str(incident, "id")))
  const roots = incidents.flatMap((incident) =>
    isRoot(incident) ? [] : (str(incident, "rootCauseIncidentId") ?? []),
  )
  return [...new Set(roots)].filter((id) => !loaded.has(id)).sort(compareText)
}

const ACTIONS: ReadonlyMap<string, PlanEntry["action"]> = new Map([
  ["failedJob", "job"],
  ["failedExternalTask", "externalTask"],
])

function actionOf(type: string, configuration: string | undefined): PlanEntry["action"] {
  return configuration === undefined ? "skip" : (ACTIONS.get(type) ?? "skip")
}

function entryOf(incident: Rec): PlanEntry {
  const type = field(incident, "incidentType")
  const configuration = str(incident, "configuration")
  const action = actionOf(type, configuration)
  return {
    incidentId: field(incident, "id"),
    type,
    activityId: field(incident, "activityId"),
    processInstanceId: field(incident, "processInstanceId"),
    ...compact({
      message: str(incident, "incidentMessage"),
      jobId: action === "job" ? configuration : undefined,
      externalTaskId: action === "externalTask" ? configuration : undefined,
    }),
    action,
  }
}

export interface RetryFilter {
  readonly activityId?: string
  readonly incidentType?: string
}

/**
 * The root causes of the incidents (propagated ones replaced by their loaded root cause,
 * deduplicated), filtered by activity and type, by time and id.
 */
export function planRetry(incidents: readonly Rec[], filter: RetryFilter): PlanEntry[] {
  const byId = new Map(incidents.map((incident) => [str(incident, "id"), incident]))
  const roots = new Map<string, Rec>()
  for (const incident of incidents) {
    const root = isRoot(incident) ? incident : byId.get(str(incident, "rootCauseIncidentId"))
    const id = str(root, "id")
    if (root !== undefined && id !== undefined && isRoot(root)) roots.set(id, root)
  }
  return [...roots.values()]
    .filter(
      (root) => filter.activityId === undefined || str(root, "activityId") === filter.activityId,
    )
    .filter(
      (root) =>
        filter.incidentType === undefined || str(root, "incidentType") === filter.incidentType,
    )
    .toSorted(
      (left, right) =>
        compareTime(str(left, "incidentTimestamp"), str(right, "incidentTimestamp")) ||
        compareText(field(left, "id"), field(right, "id")),
    )
    .map(entryOf)
}

/** Too many incidents to retry one by one: refused before any write. */
export function checkRetryCount(
  entries: readonly PlanEntry[],
  truncated: boolean,
  key: string | undefined,
): void {
  const retryable = entries.filter((entry) => entry.action !== "skip").length
  if (!truncated && retryable <= MAX_RETRIES) return
  throw new WorkflowError({
    kind: "retry-too-many",
    max: MAX_RETRIES,
    ...compact({ processDefinitionKey: key }),
  })
}

/** The retries request of an entry; undefined for skipped ones. */
export function retriesWrite(entry: PlanEntry, retries: number): PlannedWrite | undefined {
  const body = { retries }
  if (entry.jobId !== undefined) {
    return {
      label: `set the retries of job ${entry.jobId} to ${retries}`,
      operationId: "setJobRetries",
      input: { pathArgs: [entry.jobId], query: {}, body },
    }
  }
  if (entry.externalTaskId === undefined) return undefined
  return {
    label: `set the retries of external task ${entry.externalTaskId} to ${retries}`,
    operationId: "setExternalTaskResourceRetries",
    input: { pathArgs: [entry.externalTaskId], query: {}, body },
  }
}

/** The execute request of a job entry (retry now). */
export function executeWrite(entry: PlanEntry): PlannedWrite | undefined {
  if (entry.jobId === undefined) return undefined
  return {
    label: `execute job ${entry.jobId}`,
    operationId: "executeJob",
    input: { pathArgs: [entry.jobId], query: {} },
  }
}

/** What to do about an incident retry cannot fix: resolve it. */
export interface SkipStep {
  readonly action: "resolveIncident"
  readonly incidentId: string
}

/** The plan a preview shows: counts per kind and the skipped incidents. */
export function retryPlanView(mode: RetryMode, entries: readonly PlanEntry[]) {
  const skipped = entries.filter((entry) => entry.action === "skip")
  return {
    mode,
    incidents: entries.length,
    jobs: entries.filter((entry) => entry.action === "job").length,
    externalTasks: entries.filter((entry) => entry.action === "externalTask").length,
    skipped: skipped.map((entry) => ({
      incidentId: entry.incidentId,
      type: entry.type,
      next: { action: "resolveIncident", incidentId: entry.incidentId } satisfies SkipStep,
    })),
  }
}
