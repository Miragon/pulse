/**
 * "With incident" on the Camunda 7 REST API family, the one reading of every surface (owner
 * decision 2026-11-14; `COUNT_TERMS` of @miragon/pulse-ui: the instances that have an open
 * incident): an instance the runtime holds an open incident for, now. The runtime's
 * process-instance query answers it with `withIncident` (`ACT_RU_INCIDENT`) alike on every history
 * level, and an incident of a called instance flags its caller too, since the engine copies it up
 * the call chain. The history's incident filters (`withIncidents` and `incidentStatus` of the
 * historic process instances, the historic incidents) read `ACT_HI_INCIDENT`, which only history
 * level FULL writes: below it they find nothing (measured at AUDIT on Operaton 2.1.5 and CIB seven
 * 2.2.0), so no surface counts "with incident" from them, and a reading only the history gives (an
 * incident that was resolved, an instance that had one) asks `unrecordedIncidents` before it
 * answers "none".
 */

import type { EnginePort, Query } from "./port.js"
import { countOf, type Rec, str } from "./records.js"
import { listByIds, queryInput } from "./requests.js"

/** The runtime's process-instance filter of "with incident" (`getProcessInstances`, its count). */
export const WITH_INCIDENT = { withIncident: "true" } as const

/** The order the instances of a scope are paged in, so no page repeats or skips one. */
const BY_ID = { sortBy: "instanceId", sortOrder: "asc" } as const

/**
 * Where to look for instances with an open incident: a version, a process (its key), a business
 * key, each matched exactly as the historic process instances match it; none of them is the whole
 * engine.
 */
export interface IncidentScope {
  readonly processDefinitionId?: string
  readonly processDefinitionKey?: string
  readonly businessKey?: string
}

/** An instance with an open incident and the version it runs on. */
export interface InstanceWithIncident {
  readonly id: string
  readonly definitionId: string
}

function scopeQuery(scope: IncidentScope): Query {
  return {
    ...WITH_INCIDENT,
    ...(scope.processDefinitionId === undefined
      ? {}
      : { processDefinitionId: scope.processDefinitionId }),
    ...(scope.processDefinitionKey === undefined
      ? {}
      : { processDefinitionKey: scope.processDefinitionKey }),
    ...(scope.businessKey === undefined ? {} : { businessKey: scope.businessKey }),
  }
}

function idsOf(items: readonly Rec[]): string[] {
  return items.flatMap((item) => str(item, "id") ?? [])
}

/** The instances with an open incident in `scope`, every page: the id and the version of each, once. */
export async function instancesWithIncident(
  port: EnginePort,
  scope: IncidentScope,
): Promise<InstanceWithIncident[]> {
  const { items } = await port.list("getProcessInstances", { ...scopeQuery(scope), ...BY_ID })
  const byId = new Map<string, InstanceWithIncident>()
  for (const item of items) {
    const id = str(item, "id")
    const definitionId = str(item, "definitionId")
    if (id !== undefined && definitionId !== undefined) byId.set(id, { id, definitionId })
  }
  return [...byId.values()]
}

/** How many instances hold an open incident in `scope`, in one count. */
export async function countWithIncident(port: EnginePort, scope: IncidentScope): Promise<number> {
  return countOf(await port.json("getProcessInstancesCount", queryInput(scopeQuery(scope))))
}

/** Which of `ids` hold an open incident (the flag of a listed instance), 50 ids per request. */
export async function withIncidentAmong(
  port: EnginePort,
  ids: readonly string[],
): Promise<Set<string>> {
  const request = { operationId: "getProcessInstances", key: "processInstanceIds", ids }
  return new Set(idsOf(await listByIds(port, { ...request, query: WITH_INCIDENT })))
}

/** Per version (definition id), how many of `instances` hold an open incident: its "with incident". */
export function withIncidentByVersion(
  instances: readonly InstanceWithIncident[],
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const { definitionId } of instances) {
    counts.set(definitionId, (counts.get(definitionId) ?? 0) + 1)
  }
  return counts
}

/**
 * The open incidents the history did not record: the runtime's open incidents when the history
 * holds none of them open, else 0. More than 0 means the engine keeps no incident history (history
 * level below FULL), so a history query by incident finds nothing whatever it asks; 0 while the
 * runtime holds none, since the two cannot be told apart then.
 */
export async function unrecordedIncidents(port: EnginePort): Promise<number> {
  const [open, recorded] = await Promise.all([
    port.json("getIncidentsCount", queryInput({})).then(countOf),
    port.list("getHistoricIncidents", { open: "true" }, 1),
  ])
  return recorded.items.length > 0 ? 0 : open
}
