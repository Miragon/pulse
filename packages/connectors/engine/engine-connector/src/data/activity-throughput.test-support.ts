import type { Client } from "@miragon/pulse-c7-client"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import type { ActivityThroughputData } from "../view-models.js"
import { buildActivityStatisticsData } from "./activity-statistics-data.js"

// The world of the "Throughput" tests: `leasing` v2 (latest) and v1, which still started two
// instances in the window; each test file closes the engines it started (`closeEngines`).

const engines: FakeEngine[] = []

export async function closeEngines(): Promise<void> {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
}

export const KEY = "leasing"
export const V1 = "leasing:1:d1"
export const V2 = "leasing:2:d2"
const XML =
  '<definitions><process id="leasing"><userTask id="assess" name="Assess creditworthiness"/><serviceTask id="sendPolicy" name="Send policy"/></process></definitions>'

/** 2026-11-08 10:30 UTC: the 30-day window starts on the hour after 2026-10-09 10:30. */
export const NOW = Date.UTC(2026, 10, 8, 10, 30)
export const HOUR = 60 * 60 * 1000
export const STARTED_AFTER = "2026-10-09T11:00:00.000+0000"

interface Version {
  id: string
  version: number
  historyTimeToLive?: number
  tenantId?: string
  /** Deployed after the window's start. */
  deployedInWindow?: boolean
}

const VERSIONS: Version[] = [
  { id: V2, version: 2 },
  { id: V1, version: 1 },
]

export const HISTORY: Record<string, unknown[]> = {
  [V2]: [
    { id: "assess", instances: 2, finished: 38, canceled: 1 },
    { id: "sendPolicy", instances: 0, finished: 30, canceled: 0 },
  ],
  [V1]: [
    { id: "assess", instances: 0, finished: 2, canceled: 0 },
    { id: "legacyCheck", instances: 0, finished: 2, canceled: 2 },
  ],
}

/** Instances started per version, by the window's start the count asks for. */
type Started = (versionId: string, startedAfter: string) => number

const STARTED: Started = (id) => (id === V2 ? 40 : 2)

function routes(
  { versions = VERSIONS, started = STARTED }: { versions?: Version[]; started?: Started } = {},
  overrides: FakeRoutes = {},
): FakeRoutes {
  const definition = (v: Version) => ({ ...v, key: KEY, name: "Leasing" })
  return {
    "GET /process-definition": (r: RecordedRequest) => ({
      body: r.query.latestVersion
        ? [definition(versions[0])]
        : versions.filter((v) => !r.query.deployedAfter || v.deployedInWindow).map(definition),
    }),
    "GET /history/process-instance/count": (r: RecordedRequest) => {
      const of = (id: string) => started(id, r.query.startedAfter ?? "")
      return {
        body: {
          count: r.query.processDefinitionId
            ? of(r.query.processDefinitionId)
            : versions.reduce((sum, v) => sum + of(v.id), 0),
        },
      }
    },
    [`GET /history/process-definition/${V2}/statistics`]: { body: HISTORY[V2] },
    [`GET /history/process-definition/${V1}/statistics`]: { body: HISTORY[V1] },
    [`GET /process-definition/${V2}/xml`]: { body: { id: V2, bpmn20Xml: XML } },
    ...overrides,
  }
}

export async function engineWith(...args: Parameters<typeof routes>) {
  const engine = await startFakeEngine(routes(...args), { body: [] })
  engines.push(engine)
  return { engine, client: clientFor(engine) }
}

export async function throughput(client: Client, nowMs = NOW): Promise<ActivityThroughputData> {
  const data = await buildActivityStatisticsData(
    client,
    { processDefinitionKey: KEY, source: "history" },
    nowMs,
  )
  if (data.source !== "history") throw new Error("history asked, runtime answered")
  return { ...data, engineId: "fake" }
}

export const statisticsReads = (engine: FakeEngine) =>
  engine.requests.filter((r) => r.path.startsWith("/history/process-definition/"))
export const countReads = (engine: FakeEngine) =>
  engine.requests.filter((r) => r.path === "/history/process-instance/count")

export async function build(...args: Parameters<typeof routes>) {
  const { engine, client } = await engineWith(...args)
  return { data: await throughput(client), engine }
}
