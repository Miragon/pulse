import {
  LIST_PAGE_SIZE,
  type AppSection,
  type CockpitSection,
  type CockpitStartData,
  type CockpitView,
} from "../view-models.js"
import type { ResolvedEngine } from "../lib/engine/resolve-engine.js"
import { boardFacts } from "./board-facts.js"
import {
  boardFeed,
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
  type NamedReadContext,
  type ReadContext,
} from "./feeds.js"
import { landingDataOf, landingFacts } from "./landing-data.js"

/**
 * The cockpit's routes, described once: the ids each needs and takes, its start data (its feed's
 * read, `feeds.ts`, with the args its widget's first page sends) and its facts for the model.
 * `widget-tools/cockpit.ts` derives the `view` enum and the id checks from `COCKPIT_ROUTES`, and
 * `cockpit-start.ts` dispatches the start view to its route. `COCKPIT_ROUTES` is total over the
 * sections and `needs`/`takes` name fields of the route's own view, so a route missing here, or
 * an id its view lacks, fails to compile. A route's `scope` says what it reads: one engine the
 * call resolved (`engine`), or at app level (`app`) the engines it names itself (a board) or the
 * engine list (the landing), so its start resolves no engine and takes no `engine` argument. The
 * landing is the one route without a feed of its own: its start is the boards the engine list
 * names, which its widgets read.
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

/** What a route's facts may name besides its view and data: the call's own. */
export interface CallFacts {
  /** Every configured engine's id in the order of the profiles, a refused one too. */
  readonly engines: readonly string[]
}

/** The routes of one engine: every section but the app's. */
export type EngineSection = Exclude<CockpitSection, AppSection>

/** What one cockpit route says, whichever its scope. */
interface RouteParts<S extends CockpitSection> {
  /** The ids the view requires, and the ones it takes besides. */
  needs: readonly ParamOf<S>[]
  takes: readonly ParamOf<S>[]
  /**
   * The model's view of the route: ids, verdicts and counts as compact JSON with English keys,
   * engine text clipped, never XML. A null fact is unknown, never 0; an `undefined` one is left
   * out of the JSON.
   */
  facts: (view: ViewOf<S>, data: CockpitStartData[S], call: CallFacts) => Facts
}

/** A route of one engine, as `engine_open_cockpit` opens it on the engine the call resolved. */
interface EngineRoute<S extends CockpitSection> extends RouteParts<S> {
  scope: "engine"
  /** The start data: the route's feed read with the args its widget's first page sends. */
  start: (view: ViewOf<S>, engine: ResolvedEngine, ctx: ReadContext) => Promise<CockpitStartData[S]>
}

/**
 * An app route: it reads the engines it names, each by its name under the call, or the server's
 * boards alone (the landing).
 */
interface AppRoute<S extends CockpitSection> extends RouteParts<S> {
  scope: "app"
  /** The start data: the route's feed read with the args its view sends; the landing's boards. */
  start: (view: ViewOf<S>, ctx: NamedReadContext) => Promise<CockpitStartData[S]>
}

/** One cockpit route, its scope fixed by its section. */
type CockpitRoute<S extends CockpitSection> = S extends AppSection ? AppRoute<S> : EngineRoute<S>

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
    scope: "engine",
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
    scope: "engine",
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
    scope: "engine",
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
    scope: "engine",
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
    scope: "engine",
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
    scope: "engine",
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
    scope: "engine",
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
    scope: "engine",
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
    scope: "engine",
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
  board: {
    scope: "app",
    needs: ["board"],
    takes: [],
    start: (view, ctx) => boardFeed.read({ board: view.board }, ctx),
    facts: (view, data) => boardFacts(view.board, data),
  },
  // No feed of its own: the start is the boards the engine list names, which its widgets read.
  landing: {
    scope: "app",
    needs: [],
    takes: [],
    start: (_, { boards }) => Promise.resolve(landingDataOf(boards)),
    facts: (_, data, { engines }) => landingFacts(data, engines),
  },
}
