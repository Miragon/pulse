/**
 * Which incident is a root incident: the one rule of the Camunda 7 REST family, for every surface
 * that reads its incidents (the status triage, the inspection, the retry plan and the wait states
 * here, the runtime's reads under ./runtime, the engine connector's clusters and incident views,
 * the C7 adapter's retry). Camunda 7 copies an incident of a called instance to the call activity
 * above it, up to the top of the call chain: each copy names the incident it stands for in
 * `rootCauseIncidentId`, and a root incident names itself. Pure.
 */

/** What the rule reads of an incident: an engine answer, or a surface's row of one. */
interface IncidentIds {
  readonly id?: unknown
  readonly rootCauseIncidentId?: unknown
}

/** A non-empty string, else undefined, as `str` reads a value of an engine answer. */
function idOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/**
 * The id of the root incident `incident` is a copy of, undefined for a root incident.
 *
 * An incident whose `rootCauseIncidentId` is missing (absent, null or empty) is a root incident.
 * Camunda 7 sends the field on every incident, a root's own id on a root, so no engine of the
 * family answers this case; it is decided here once, and as a root because a missing id names no
 * other incident: read as a copy, the incident would drop out of every count, group and plan as
 * the copy of a root no read can find. An incident without an id of its own that names a root is
 * a copy of that root.
 */
export function rootIdOfCopy(incident: IncidentIds): string | undefined {
  const root = idOf(incident.rootCauseIncidentId)
  return root === idOf(incident.id) ? undefined : root
}

/**
 * Whether `incident` was raised where it is, not copied up from a called instance: it names no
 * root incident but itself (`rootIdOfCopy`, which also decides a missing `rootCauseIncidentId`).
 */
export function isRootIncident(incident: IncidentIds): boolean {
  return rootIdOfCopy(incident) === undefined
}
