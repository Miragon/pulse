/**
 * Wait conditions (`--until`): parsing, the requests each condition
 * needs per poll, and the order in which a poll decides.
 */

import type { EnginePort } from "../engine-port/engine-port.js"
import { usageError } from "../errors.js"
import { countByIds } from "./engine.js"

export type Condition =
  | { readonly kind: "idle" | "ended" | "incident" }
  | { readonly kind: "task"; readonly key?: string }
  | { readonly kind: "activity"; readonly id: string }

/** The accepted forms, for usage errors and help texts. */
const CONDITION_FORMS = [
  "idle",
  "ended",
  "incident",
  "task",
  "task:<taskDefinitionKey>",
  "activity:<activityId>",
]

function invalid(raw: string) {
  return usageError(
    `--until expects one of ${CONDITION_FORMS.join(", ")}, got "${raw}"`,
    "Example: --until task:approve --until ended (any one of them ends the wait).",
  )
}

export function parseCondition(raw: string): Condition {
  if (raw === "idle" || raw === "ended" || raw === "incident" || raw === "task") {
    return { kind: raw }
  }
  const [prefix, ...rest] = raw.split(":")
  const id = rest.join(":")
  if (id === "" || (prefix !== "task" && prefix !== "activity")) throw invalid(raw)
  return prefix === "task" ? { kind: "task", key: id } : { kind: "activity", id }
}

export function conditionLabel(condition: Condition): string {
  switch (condition.kind) {
    case "activity":
      return `activity:${condition.id}`
    case "task":
      return condition.key === undefined ? "task" : `task:${condition.key}`
    default:
      return condition.kind
  }
}

/** The instance as one poll saw it. */
export interface Probe {
  readonly id: string
  readonly ended: boolean
  /** The active tree (empty once the instance ended). */
  readonly tree: readonly string[]
  /** The tree was cut: instances beyond the cut are not counted. */
  readonly truncated?: boolean
}

export interface Measurement {
  /** Instances of the tree with an incident. */
  readonly incidents: number
  /** Labels of the conditions that hold, other than `incident`, in the given order. */
  readonly held: readonly string[]
}

/** Counts over the instances of the tree (`processInstanceIds` of process instances). */
function countInTree(port: EnginePort, tree: readonly string[], query: Record<string, string>) {
  return countByIds(port, {
    operationId: "getProcessInstancesCount",
    key: "processInstanceIds",
    ids: tree,
    query,
  })
}

async function activityReached(port: EnginePort, probe: Probe, activityId: string) {
  const ids = [...new Set([probe.id, ...probe.tree])]
  const history = { operationId: "getHistoricActivityInstancesCount", key: "processInstanceId" }
  const [active, ...finished] = await Promise.all([
    countInTree(port, probe.tree, { activityIdIn: activityId }),
    ...ids.map((pid) => countByIds(port, { ...history, ids: [pid], query: { activityId } })),
  ])
  return active > 0 || finished.some((count) => count > 0)
}

/**
 * The jobs the job executor will run: retries left, due, and active. The engine's `executable`
 * filter checks the suspension of the instance only, not of the job (a suspended job definition
 * suspends its jobs), hence `active` (verified on all three engines).
 */
export const EXECUTABLE = { executable: "true", active: "true" } as const

/** No executable job in the tree; an ended instance has no tree and is idle. */
async function idle(port: EnginePort, probe: Probe): Promise<boolean> {
  const request = { operationId: "getJobsCount", key: "processInstanceIds", ids: probe.tree }
  return (await countByIds(port, { ...request, query: EXECUTABLE })) === 0
}

async function taskOpen(port: EnginePort, probe: Probe, key: string | undefined) {
  const query = key === undefined ? {} : { taskDefinitionKey: key }
  const request = { operationId: "getTasksCount", key: "processInstanceIdIn", ids: probe.tree }
  return (await countByIds(port, { ...request, query })) > 0
}

async function holds(port: EnginePort, probe: Probe, condition: Condition): Promise<boolean> {
  switch (condition.kind) {
    case "ended":
      return probe.ended
    case "incident":
      return false
    case "idle":
      return idle(port, probe)
    case "task":
      return taskOpen(port, probe, condition.key)
    case "activity":
      return activityReached(port, probe, condition.id)
  }
}

/**
 * The counts of one poll: only what the conditions need, then the incident check. The incident
 * count is read after the condition counts, never in parallel with them: a job that fails for good
 * loses its last retry and gets its incident in one transaction, so a job count that no longer sees
 * the job is followed by an incident count that sees the incident. Read in parallel, the incident
 * count could come from before that transaction and the job count from after it, and the poll
 * would see neither (a stuck instance reported as idle).
 */
export async function measure(
  port: EnginePort,
  probe: Probe,
  conditions: readonly Condition[],
  checkIncidents: boolean,
): Promise<Measurement> {
  const results = await Promise.all(conditions.map((condition) => holds(port, probe, condition)))
  const incidents = checkIncidents
    ? await countInTree(port, probe.tree, { withIncident: "true" })
    : 0
  const held = conditions.filter((_, index) => results[index] === true).map(conditionLabel)
  return { incidents, held }
}

export type Verdict =
  | { readonly kind: "held"; readonly until: string }
  | { readonly kind: "incident" }
  | { readonly kind: "ended" }
  | { readonly kind: "pending" }

/**
 * The decision of a poll: `--until incident` with an incident, then an incident with fail fast
 * (a job that failed for good is not executable, so `idle` would otherwise report success for a
 * stuck instance), then any other condition, then an ended instance.
 */
export function decide(
  conditions: readonly Condition[],
  failOnIncident: boolean,
  probe: Probe,
  measurement: Measurement,
): Verdict {
  const wantsIncident = conditions.some((condition) => condition.kind === "incident")
  if (wantsIncident && measurement.incidents > 0) return { kind: "held", until: "incident" }
  if (failOnIncident && measurement.incidents > 0) return { kind: "incident" }
  const [until] = measurement.held
  if (until !== undefined) return { kind: "held", until }
  return probe.ended ? { kind: "ended" } : { kind: "pending" }
}
