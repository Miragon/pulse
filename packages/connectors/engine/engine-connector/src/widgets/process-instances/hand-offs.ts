import type { ProcessInstanceRow } from "../../view-models.js"
import type { HandOff, ViewContext } from "../lib/hand-off.js"

export type InstanceChip = "all" | "incidents" | "suspended"

/**
 * The feed's echo of the page on screen, never the request: while a newer query is in flight
 * or failed, the new filters next to the old count would be a pair nobody fetched.
 */
export interface InstancesListFilters {
  active?: boolean
  suspended?: boolean
  withIncidents?: boolean
  /** Quoted, never inlined. */
  businessKeyLike?: string
  /** Quoted, never inlined. */
  search?: string
}

export function instancesFilterFacts(filters: InstancesListFilters) {
  return {
    active: filters.active,
    suspended: filters.suspended,
    withIncidents: filters.withIncidents,
  }
}

/** The business key is the starter's text: quoted. */
export function rootCauseHandOff(
  row: ProcessInstanceRow,
  processDefinitionKey: string | null,
  engine: string | undefined,
): HandOff {
  return {
    intent: "askAi.instances.rootCause",
    ids: {
      engine,
      processInstanceId: row.id,
      processDefinitionKey: processDefinitionKey ?? row.processDefinitionKey,
    },
    facts: { version: row.version },
    untrusted: [{ label: "businessKey", text: row.businessKey }],
  }
}

const PREVIOUS_RESULT_NOTE =
  " The operator has changed the search or filter, but the new result has not loaded (still loading, or failed): the list still shows its PREVIOUS result, which the numbers and filters below describe."

/** The process name, business-key filter and search are quoted, never inlined. */
export function describeInstancesView({
  loadedCount,
  total,
  scopedKey,
  processName,
  engine,
  filters,
  previousResult,
}: {
  loadedCount: number
  total: number
  scopedKey: string | null
  processName: string | null
  engine: string | undefined
  filters: InstancesListFilters
  previousResult: boolean
}): ViewContext {
  const view = scopedKey
    ? "The operator is viewing the running instances of one process definition."
    : "The operator is viewing the running instances across ALL process definitions."
  return {
    summary: previousResult ? view + PREVIOUS_RESULT_NOTE : view,
    ids: { engine, processDefinitionKey: scopedKey },
    facts: {
      loaded: loadedCount,
      matchingInstances: total,
      ...instancesFilterFacts(filters),
    },
    untrusted: [
      { label: "processName", text: processName },
      { label: "businessKeyLike", text: filters.businessKeyLike },
      { label: "search", text: filters.search },
    ],
  }
}
