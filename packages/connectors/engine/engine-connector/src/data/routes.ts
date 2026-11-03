import {
  LIST_PAGE_SIZE,
  type CockpitSection,
  type CockpitStartData,
  type CockpitView,
} from "../view-models.js"
import type { ResolvedEngine } from "../lib/engine/resolve-engine.js"
import {
  clusterDetailFeed,
  healthFeed,
  historyTimelineFeed,
  incidentDetailFeed,
  incidentsFeed,
  instanceDetailFeed,
  jobsFeed,
  overviewFeed,
  processIncidentsFeed,
  processInstancesFeed,
  type ReadContext,
} from "./feeds.js"

/**
 * The cockpit's routes, described once: the ids each needs and takes, its start data (its feed's
 * read, `feeds.ts`, with the args its widget's first page sends) and its facts for the model.
 * `widget-tools/cockpit.ts` derives the `view` enum and the id checks from `COCKPIT_ROUTES`, and
 * `cockpit-start.ts` dispatches the start view to its route. `COCKPIT_ROUTES` is total over the
 * sections and `needs`/`takes` name fields of the route's own view, so a route missing here, or
 * an id its view lacks, fails to compile.
 */

type ViewOf<S extends CockpitSection> = Extract<CockpitView, { section: S }>

/** A start param of one route: a field of its view, besides its section and its display label. */
type ParamOf<S extends CockpitSection> = Exclude<keyof ViewOf<S>, "section" | "label">

/**
 * The ids a start view may carry, besides `view` itself: every route's params, read off
 * `CockpitView`, so `widget-tools/cockpit.ts` holds its input shape to the view models.
 */
export type StartParam = { [S in CockpitSection]: ParamOf<S> }[CockpitSection]

export type Facts = Record<string, unknown>

/** One cockpit route, as `engine_open_cockpit` opens it. */
interface CockpitRoute<S extends CockpitSection> {
  /** The ids the view requires, and the ones it takes besides. */
  needs: readonly ParamOf<S>[]
  takes: readonly ParamOf<S>[]
  /** The start data: the route's feed read with the args its widget's first page sends. */
  start: (view: ViewOf<S>, engine: ResolvedEngine, ctx: ReadContext) => Promise<CockpitStartData[S]>
  /**
   * The model's view of the route: ids, verdicts and counts as compact JSON with English keys,
   * engine text clipped, never XML. A null fact is unknown, never 0; an `undefined` one is left
   * out of the JSON.
   */
  facts: (view: ViewOf<S>, data: CockpitStartData[S]) => Facts
}

const PAGE_0 = { firstResult: 0, maxResults: LIST_PAGE_SIZE }

/** Engine text is stacktrace-sized: flattened and capped, null stays null. */
function clip(text: string | null, max: number): string | null {
  if (text === null) return null
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function instanceState(instance: { ended: boolean; suspended: boolean }): string {
  if (instance.ended) return "ended"
  return instance.suspended ? "suspended" : "running"
}

/**
 * Every cockpit route; total over the sections, so a new section fails to compile until it is
 * here, and the key order is the order of `engine_open_cockpit`'s `view` enum.
 */
export const COCKPIT_ROUTES: { readonly [S in CockpitSection]: CockpitRoute<S> } = {
  overview: {
    needs: [],
    takes: [],
    start: async (_, engine, ctx) => {
      const [health, definitions] = await Promise.all([
        healthFeed.read({}, engine, ctx),
        overviewFeed.read({}, engine, ctx),
      ])
      return { health, definitions }
    },
    facts: (_, { health, definitions }) => {
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
  },
  incidents: {
    needs: [],
    takes: [],
    start: (_, engine, ctx) => incidentsFeed.read({}, engine, ctx),
    facts: (_, data) => ({
      totalCount: data.totalCount,
      processCount: data.processCount,
      last24hCount: data.last24hCount,
      affectedActivityCount: data.affectedActivityCount,
      latestIncident: data.latestIncident,
    }),
  },
  "cluster-detail": {
    needs: ["activityId", "incidentType"],
    takes: ["messageSignature"],
    start: (view, engine, ctx) =>
      clusterDetailFeed.read(
        {
          activityId: view.activityId,
          incidentType: view.incidentType,
          messageSignature: view.messageSignature,
          ...PAGE_0,
        },
        engine,
        ctx,
      ),
    facts: (_, data) => ({
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
  },
  "process-detail": {
    needs: ["processDefinitionKey"],
    takes: ["focus"],
    start: (view, engine, ctx) =>
      processIncidentsFeed.read({ processDefinitionKey: view.processDefinitionKey }, engine, ctx),
    facts: (view, data) => ({
      processDefinitionKey: data.processDefinitionKey,
      focus: view.focus,
      diagramVersion: data.diagramVersion,
      runningInstances: data.runningInstances,
      incidentCount: data.incidentCount,
      last24hCount: data.last24hCount,
      failedJobs: data.failedJobs,
      affectedActivities: data.activities.length,
    }),
  },
  "process-instances": {
    needs: [],
    takes: ["processDefinitionKey"],
    start: (view, engine, ctx) =>
      processInstancesFeed.read(
        { processDefinitionKey: view.processDefinitionKey, ...PAGE_0 },
        engine,
        ctx,
      ),
    facts: (_, data) => ({
      processDefinitionKey: data.processDefinitionKey,
      totalCount: data.totalCount,
      withIncidentCount: data.withIncidentCount,
      suspendedCount: data.suspendedCount,
      returnedCount: data.returnedCount,
    }),
  },
  "instance-detail": {
    needs: ["processInstanceId"],
    takes: [],
    start: (view, engine, ctx) =>
      instanceDetailFeed.read({ processInstanceId: view.processInstanceId }, engine, ctx),
    facts: (_, data) => ({
      processInstanceId: data.instance.id,
      businessKey: data.instance.businessKey,
      processDefinitionKey: data.definitionKey,
      state: instanceState(data.instance),
      activeActivityIds: data.activeActivityIds,
      incidentCount: data.incidentCount,
      openTaskCount: data.openTaskCount,
    }),
  },
  "incident-detail": {
    needs: ["incidentId"],
    takes: [],
    start: (view, engine, ctx) =>
      incidentDetailFeed.read({ incidentId: view.incidentId }, engine, ctx),
    facts: (_, data) => ({
      incidentId: data.incidentId,
      incidentType: data.incidentType,
      activityId: data.activityId,
      processDefinitionKey: data.processDefinitionKey,
      processInstanceId: data.processInstanceId,
      businessKey: data.businessKey,
      incidentMessage: clip(data.incidentMessage, 160),
    }),
  },
  jobs: {
    needs: [],
    takes: ["processDefinitionKey", "failedOnly"],
    start: (view, engine, ctx) =>
      jobsFeed.read(
        { processDefinitionKey: view.processDefinitionKey, failedOnly: view.failedOnly, ...PAGE_0 },
        engine,
        ctx,
      ),
    facts: (view, data) => ({
      processDefinitionKey: view.processDefinitionKey,
      failedOnly: view.failedOnly === true ? true : undefined,
      totalCount: data.totalCount,
      failedCount: data.failedCount,
    }),
  },
  history: {
    needs: ["processInstanceId"],
    takes: [],
    start: (view, engine, ctx) =>
      historyTimelineFeed.read({ processInstanceId: view.processInstanceId }, engine, ctx),
    facts: (view, { processInstance, totalActivities }) => ({
      processInstanceId: view.processInstanceId,
      found: processInstance !== null,
      state: processInstance?.state ?? null,
      processDefinitionKey: processInstance?.processDefinitionKey ?? null,
      startTime: processInstance?.startTime ?? null,
      endTime: processInstance?.endTime ?? null,
      totalActivities,
    }),
  },
}
