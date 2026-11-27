/**
 * The page's own screens at the places of an engine's process and instance: the process screen at
 * a process's view or the list of its instances, the instance screen at an instance's view or its
 * history (`screenOf` of routes.ts, which names the place).
 */

import { isSegment } from "./paths.js"
import type { PageScreen } from "./page-screen.js"
import { RUNNING_LIST } from "./screen-queries.js"

/** A place of the cockpit, as routes.ts's `Place` names it. */
type Place = Readonly<Record<string, unknown>>

/**
 * The places of a process's view (its focus, its tenant) and of the list of its instances (the
 * tenant a process narrowed it to), as their shapes spell them: the process screen's.
 */
export const PROCESS_PLACES: ReadonlySet<string> = new Set([
  "engine,processDefinitionKey,view",
  "engine,focus,processDefinitionKey,view",
  "engine,processDefinitionKey,tenantId,view",
  "engine,focus,processDefinitionKey,tenantId,view",
  "engine,onlyTenant,processDefinitionKey,view",
])

/** The instance screen at an instance's view or its history (its tab) on `engine`. */
export function instanceScreenOf(engine: string, place: Place): PageScreen | undefined {
  const { view, processInstanceId: instance } = place
  if (!isSegment(instance)) return undefined
  if (view === "history") return { kind: "instance", engine, instance, tab: "history" }
  return view === "instance-detail" ? { kind: "instance", engine, instance } : undefined
}

/**
 * The process screen at a process's view or the list of its instances on `engine`, where the
 * process's id can be a segment of its address: in the tenant the place names (a process's, or the
 * one its list is narrowed to, which a process whose key holds others opens; none for null, the
 * process without one), its running instances listed, with its incidents in focus those with
 * incident.
 */
export function processScreenOf(engine: string, place: Place): PageScreen | undefined {
  const { view, focus, processDefinitionKey: process } = place
  const tenantId = place.tenantId ?? place.onlyTenant
  if (!isSegment(process)) return undefined
  const instances = view === "process-instances" && focus === undefined
  if (view !== "process-detail" && !instances) return undefined
  const inTenant = typeof tenantId === "string" && tenantId !== "" ? { tenantId } : {}
  if (focus === undefined) {
    return { kind: "process", engine, process, ...inTenant, filter: RUNNING_LIST }
  }
  return focus === "incidents"
    ? { kind: "process", engine, process, ...inTenant, filter: { scope: "withIncident" } }
    : undefined
}
