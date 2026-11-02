import {
  LIST_PAGE_SIZE,
  type CockpitSection,
  type CockpitStart,
  type CockpitStartData,
  type CockpitView,
} from "../view-models.js"
import type { EngineHealthThresholds } from "./health-data.js"
import {
  readClusterDetail,
  readCockpitOverview,
  readEngineHealth,
  readHistoryTimeline,
  readIncidentDetail,
  readIncidents,
  readInstanceDetail,
  readJobs,
  readProcessIncidents,
  readProcessInstances,
  type ReadEngine,
} from "./route-reads.js"

type ViewOf<S extends CockpitSection> = Extract<CockpitView, { section: S }>

type StartBuilders = {
  [S in CockpitSection]: (
    view: ViewOf<S>,
    engine: ReadEngine,
    thresholds: EngineHealthThresholds,
  ) => Promise<CockpitStartData[S]>
}

const PAGE_0 = { firstResult: 0, maxResults: LIST_PAGE_SIZE }

/** Each route's feed read (`route-reads.ts`) with the args its widget's first page sends. */
const BUILDERS: StartBuilders = {
  overview: async (_, engine, thresholds) => {
    const [health, definitions] = await Promise.all([
      readEngineHealth(engine, thresholds),
      readCockpitOverview({}, engine),
    ])
    return { health, definitions }
  },
  incidents: (_, engine) => readIncidents({}, engine),
  "cluster-detail": (view, engine) =>
    readClusterDetail(
      {
        activityId: view.activityId,
        incidentType: view.incidentType,
        messageSignature: view.messageSignature,
        ...PAGE_0,
      },
      engine,
    ),
  "process-detail": (view, engine) =>
    readProcessIncidents({ processDefinitionKey: view.processDefinitionKey }, engine),
  "process-instances": (view, engine) =>
    readProcessInstances({ processDefinitionKey: view.processDefinitionKey, ...PAGE_0 }, engine),
  "instance-detail": (view, engine) =>
    readInstanceDetail({ processInstanceId: view.processInstanceId }, engine),
  "incident-detail": (view, engine) => readIncidentDetail({ incidentId: view.incidentId }, engine),
  jobs: (view, engine) =>
    readJobs(
      { processDefinitionKey: view.processDefinitionKey, failedOnly: view.failedOnly, ...PAGE_0 },
      engine,
    ),
  history: (view, engine) =>
    readHistoryTimeline({ processInstanceId: view.processInstanceId }, engine),
}

/** The start view with its data: a failed primary read fails the call, never a view of zeros. */
export async function buildCockpitStart(
  view: CockpitView,
  engine: ReadEngine,
  thresholds: EngineHealthThresholds,
): Promise<CockpitStart> {
  // The record is total over the sections, so the view's own builder takes the view.
  const build = BUILDERS[view.section] as (
    view: CockpitView,
    engine: ReadEngine,
    thresholds: EngineHealthThresholds,
  ) => Promise<CockpitStart["data"]>
  return { view, data: await build(view, engine, thresholds) } as CockpitStart
}

/** Engine text is stacktrace-sized: flattened and capped, null stays null. */
function clip(text: string | null, max: number): string | null {
  if (text === null) return null
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

type Facts = Record<string, unknown>

type FactBuilders = {
  [S in CockpitSection]: (view: ViewOf<S>, data: CockpitStartData[S]) => Facts
}

/**
 * The model's view of each route: ids, verdicts and counts as compact JSON with English keys,
 * engine text clipped, never XML. A null fact is unknown, never 0.
 */
const FACTS: FactBuilders = {
  overview: (_, { health, definitions }) => {
    const top = health.clusters[0]
    const s = health.summary
    return {
      status: health.status,
      statusRule: health.statusRule,
      totalIncidents: s.totalIncidents,
      lastHourIncidents: s.lastHourIncidents,
      last24hIncidents: s.last24hIncidents,
      affectedActivities: s.affectedActivities,
      affectedDefinitions: s.affectedDefinitions,
      runningInstances: s.runningInstances,
      totalDefinitions: s.totalDefinitions,
      started24h: s.started24h,
      completed24h: s.completed24h,
      totalFailedJobs: definitions.summary.totalFailedJobs,
      topCluster: top
        ? {
            activityId: top.activityId,
            incidentType: top.incidentType,
            messageSignature: top.messageSignature,
            incidentCount: top.incidentCount,
            scannedIncidentCount: top.scannedIncidentCount,
            processDefinitionKeys: top.processDefinitionKeys,
          }
        : null,
    }
  },
  incidents: (_, data) => ({
    totalCount: data.totalCount,
    processCount: data.processCount,
    last24hCount: data.last24hCount,
    affectedActivityCount: data.affectedActivityCount,
    latestIncident: data.latestIncident,
  }),
  "cluster-detail": (_, data) => ({
    activityId: data.activityId,
    incidentType: data.incidentType,
    messageSignature: data.messageSignature,
    incidentCount: data.incidentCount,
    scannedIncidentCount: data.scannedIncidentCount,
    lastHourCount: data.lastHourCount,
    last24hCount: data.last24hCount,
    processDefinitionKeys: data.processDefinitionKeys,
    sampleMessage: clip(data.representativeMessage, 140),
  }),
  "process-detail": (view, data) => ({
    processDefinitionKey: data.processDefinitionKey,
    focus: view.focus,
    diagramVersion: data.diagramVersion,
    runningInstances: data.runningInstances,
    incidentCount: data.incidentCount,
    last24hCount: data.last24hCount,
    failedJobs: data.failedJobs,
    affectedActivities: data.activities.length,
  }),
  "process-instances": (_, data) => ({
    processDefinitionKey: data.processDefinitionKey,
    totalCount: data.totalCount,
    withIncidentCount: data.withIncidentCount,
    suspendedCount: data.suspendedCount,
    returnedCount: data.returnedCount,
  }),
  "instance-detail": (_, data) => ({
    processInstanceId: data.instance.id,
    businessKey: data.instance.businessKey,
    processDefinitionKey: data.definitionKey,
    state: instanceState(data.instance),
    activeActivityIds: data.activeActivityIds,
    incidentCount: data.incidentCount,
    openTaskCount: data.openTaskCount,
  }),
  "incident-detail": (_, data) => ({
    incidentId: data.incidentId,
    incidentType: data.incidentType,
    activityId: data.activityId,
    processDefinitionKey: data.processDefinitionKey,
    processInstanceId: data.processInstanceId,
    businessKey: data.businessKey,
    incidentMessage: clip(data.incidentMessage, 160),
  }),
  jobs: (view, data) => ({
    processDefinitionKey: view.processDefinitionKey,
    failedOnly: view.failedOnly === true ? true : undefined,
    totalCount: data.totalCount,
    failedCount: data.failedCount,
  }),
  history: (view, { processInstance, totalActivities }) => ({
    processInstanceId: view.processInstanceId,
    found: processInstance !== null,
    state: processInstance?.state ?? null,
    processDefinitionKey: processInstance?.processDefinitionKey ?? null,
    startTime: processInstance?.startTime ?? null,
    endTime: processInstance?.endTime ?? null,
    totalActivities,
  }),
}

function instanceState(instance: { ended: boolean; suspended: boolean }): string {
  if (instance.ended) return "ended"
  return instance.suspended ? "suspended" : "running"
}

/** The start view's facts for the model; an `undefined` fact is left out of the JSON. */
export function cockpitFacts({ view, data }: CockpitStart): Facts {
  const facts = FACTS[view.section] as (view: CockpitView, data: CockpitStart["data"]) => Facts
  return facts(view, data)
}
