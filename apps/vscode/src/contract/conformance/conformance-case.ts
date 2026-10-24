import type { ConformanceHarness } from "./harness.js"

export interface ConformanceCase {
  readonly name: string
  run(harness: ConformanceHarness): Promise<void>
}

export const CASE = {
  engineDescribesItself: "engine: describes itself with a product and a version",
  unreachableEngine: 'errors: an unreachable engine fails as RuntimeError "unreachable"',
  definitionsLatestVersion: "definitions: one summary per process, carrying its latest version",
  definitionsCounts: "definitions: counts running instances and instances with an incident",
  versionsCounts: "versions: one summary per version with its own counts, newest first",
  diagramOfVersion: "diagram: the XML of a version contains its elements, unknown is undefined",
  statisticsPerVersion: "statistics: address one version, never the whole process",
  statisticsDisjoint:
    "statistics: an element with an incident raised there is not also counted as active",
  statisticsCalledIncidents:
    "statistics: split incidents raised here from those in called instances",
  callsResolveTheCalledVersion:
    "calls: a call activity names the process it calls and the deployed version it starts",
  instancesByVersionAndLifecycle: "instances: filter by version and lifecycle",
  instancesAcrossVersions: "instances: filter by process across versions",
  instancesWithIncident: "instances: filter and flag instances with an incident",
  instancesEndedByBusinessKey: "instances: find an ended instance by business key",
  instancesByActiveElement:
    "instances: filter by the element they wait at, also before an asynchronous task",
  instancesPaging: "instances: pages without gaps or duplicates",
  instancesUtcTimestamps: "instances: timestamps are ISO-8601 in UTC",
  instancesCounted: "instances: counts agree with the search",
  instancesByIds: "instances: filter by up to 1000 instance ids",
  detailUnknown: "detail: an unknown instance is undefined",
  detailUserTask: "detail: a user task wait state with the instance variables",
  detailIncident: "detail: an incident at the failing element",
  detailCalledInstance: "detail: an incident in a called instance is reported once, at its origin",
  detailWaitsAcrossCalledInstances:
    "detail: wait states span the called instances and name the instance that waits",
  detailEnded: "detail: an ended instance has no wait states and no incidents",
  detailPath:
    "detail: the path lists the elements an instance went through in start order, open ones without an end",
  detailVariableKinds: "detail: every variable of a running instance names its kind",
  detailElementScope: "detail: a variable local to an element names that element as its scope",
  incidentsRootOnly: "incidents: only root incidents are listed",
  incidentsFiltered: "incidents: filter by process and by instance",
  incidentsNameTheirVersion: "incidents: each incident names the version it was raised in",
  incidentDetailsComplete: "incidents: details are complete, unknown is undefined",
  migrationProposal:
    "migration: the proposal between two versions maps the elements where tokens wait and checks clean",
  migrationCheck: "migration: the check names the mapping between incompatible elements",
} as const

export type CaseName = (typeof CASE)[keyof typeof CASE]
