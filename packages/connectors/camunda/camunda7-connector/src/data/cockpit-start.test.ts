import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MCPServer } from "mcp-use"
import { resolveEngine } from "../lib/resolve-engine.js"
import { engineParamShape } from "../lib/with-engine.js"
import {
  CAMUNDA7_CLUSTER_DETAIL_DATA,
  CAMUNDA7_COCKPIT_OVERVIEW_DATA,
  CAMUNDA7_ENGINE_HEALTH_DATA,
  CAMUNDA7_HISTORY_TIMELINE_DATA,
  CAMUNDA7_INCIDENT_DETAIL_DATA,
  CAMUNDA7_INCIDENTS_DATA,
  CAMUNDA7_INSTANCE_DETAIL_DATA,
  CAMUNDA7_JOBS_DATA,
  CAMUNDA7_PROCESS_INCIDENTS_DATA,
  CAMUNDA7_PROCESS_INSTANCES_DATA,
} from "../tool-names.js"
import { registryFor, startFakeEngine, type FakeEngine } from "../tools/test-support/fake-engine.js"
import { WORLD, worldReply } from "../tools/test-support/engine-world.js"
import { feedPayload } from "../tools/test-support/feed-payload.js"
import {
  HISTORY_PAGE_SIZE,
  LIST_PAGE_SIZE,
  type CockpitSection,
  type CockpitView,
} from "../view-models.js"
import { registerWidgetDataFeeds } from "../widget-tools/data-feeds.js"
import { messageSignature } from "./cluster-scan.js"
import { buildCockpitStart } from "./cockpit-start.js"
import { DEFAULT_HEALTH_THRESHOLDS } from "./health-data.js"

// The clock the health and cluster views stamp (`fetchedAt`), so the start and the feed agree.
const NOW = "2026-10-10T08:00:00.000Z"

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(NOW))
})

const engines: FakeEngine[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

type FeedHandler = (args: Record<string, unknown>, ctx: unknown) => Promise<unknown>

/** The fake engine world, its feeds as the widgets call them, and the start view on it. */
async function world() {
  const engine = await startFakeEngine({}, worldReply)
  engines.push(engine)
  const registry = registryFor(engine)
  const feeds = new Map<string, FeedHandler>()
  registerWidgetDataFeeds({
    server: {
      tool: (definition: { name: string }, handler: FeedHandler) =>
        feeds.set(definition.name, handler),
    } as unknown as MCPServer,
    registry,
    healthThresholds: DEFAULT_HEALTH_THRESHOLDS,
    toolset: "read-only",
    engineParam: engineParamShape,
  })
  return {
    feed: async (name: string, args: Record<string, unknown>) =>
      feedPayload(await feeds.get(name)!(args, {})),
    start: (view: CockpitView) =>
      buildCockpitStart(view, resolveEngine(undefined, registry), DEFAULT_HEALTH_THRESHOLDS),
  }
}

type Feed = Awaited<ReturnType<typeof world>>["feed"]

const PAGE_0 = { firstResult: 0, maxResults: LIST_PAGE_SIZE }

/** Each route with the feed reads of its widget's first page; total, so a new route must list its seed. */
const SEEDS: Record<CockpitSection, { view: CockpitView; read: (feed: Feed) => Promise<unknown> }> =
  {
    overview: {
      view: { section: "overview" },
      read: async (feed) => ({
        health: await feed(CAMUNDA7_ENGINE_HEALTH_DATA, {}),
        definitions: await feed(CAMUNDA7_COCKPIT_OVERVIEW_DATA, {}),
      }),
    },
    incidents: {
      view: { section: "incidents" },
      read: (feed) => feed(CAMUNDA7_INCIDENTS_DATA, {}),
    },
    "cluster-detail": {
      view: {
        section: "cluster-detail",
        activityId: WORLD.activityId,
        incidentType: "failedJob",
        messageSignature: messageSignature("card declined"),
      },
      read: (feed) =>
        feed(CAMUNDA7_CLUSTER_DETAIL_DATA, {
          activityId: WORLD.activityId,
          incidentType: "failedJob",
          messageSignature: messageSignature("card declined"),
          ...PAGE_0,
        }),
    },
    "process-detail": {
      view: { section: "process-detail", processDefinitionKey: WORLD.key, focus: "incidents" },
      read: (feed) => feed(CAMUNDA7_PROCESS_INCIDENTS_DATA, { processDefinitionKey: WORLD.key }),
    },
    "process-instances": {
      view: { section: "process-instances", processDefinitionKey: WORLD.key },
      read: (feed) =>
        feed(CAMUNDA7_PROCESS_INSTANCES_DATA, { processDefinitionKey: WORLD.key, ...PAGE_0 }),
    },
    "instance-detail": {
      view: { section: "instance-detail", processInstanceId: WORLD.instanceId },
      read: (feed) => feed(CAMUNDA7_INSTANCE_DETAIL_DATA, { processInstanceId: WORLD.instanceId }),
    },
    "incident-detail": {
      view: { section: "incident-detail", incidentId: WORLD.incidentId },
      read: (feed) => feed(CAMUNDA7_INCIDENT_DETAIL_DATA, { incidentId: WORLD.incidentId }),
    },
    jobs: {
      view: { section: "jobs", processDefinitionKey: WORLD.key, failedOnly: true },
      read: (feed) =>
        feed(CAMUNDA7_JOBS_DATA, { processDefinitionKey: WORLD.key, failedOnly: true, ...PAGE_0 }),
    },
    history: {
      view: { section: "history", processInstanceId: WORLD.instanceId },
      read: (feed) => feed(CAMUNDA7_HISTORY_TIMELINE_DATA, { processInstanceId: WORLD.instanceId }),
    },
  }

describe("buildCockpitStart: the seed is the feed", () => {
  it.each(Object.entries(SEEDS))(
    "%s: the start data is the route feed's first page",
    async (section, { view, read }) => {
      const { feed, start } = await world()
      const built = await start(view)
      expect(built.view).toEqual(view)
      expect(built.view.section).toBe(section)
      expect(built.data).toEqual(await read(feed))
      // No payload carries BPMN XML: some hosts hand `structuredContent` to the model.
      expect(JSON.stringify(built)).not.toContain("bpmnXml")
      expect(JSON.stringify(built)).not.toContain("<?xml")
    },
  )

  it("pages the lists and the history by the size their widgets page by", async () => {
    const engine = await startFakeEngine({}, worldReply)
    engines.push(engine)
    const resolved = resolveEngine(undefined, registryFor(engine))
    await buildCockpitStart({ section: "jobs" }, resolved, DEFAULT_HEALTH_THRESHOLDS)
    await buildCockpitStart(
      { section: "history", processInstanceId: WORLD.instanceId },
      resolved,
      DEFAULT_HEALTH_THRESHOLDS,
    )
    const pages = engine.requests
      .filter((r) => r.path === "/job" || r.path === "/history/activity-instance")
      .map((r) => [r.path, r.query.firstResult ?? null, r.query.maxResults])
    expect(pages).toEqual([
      ["/job", "0", String(LIST_PAGE_SIZE)],
      ["/history/activity-instance", null, String(HISTORY_PAGE_SIZE)],
    ])
  })
})
