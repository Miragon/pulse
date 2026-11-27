import { afterEach, describe, expect, it } from "vitest"
import { engineDateMillis } from "@miragon/pulse-c7-core"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeReply,
  type FakeRoutes,
} from "../tools/test-support/fake-engine.js"
import { DAY_MS } from "./engine-reads.js"
import { buildEngineHealthData } from "./health-data.js"

/**
 * The overview's instances started and completed in the last 24 h. An engine at history level
 * `none` counts 0 in its history while instances run, so while one runs the overview says it writes
 * no history, never "0 · 0" (#689, F138); a quiet day of an engine that writes history stays 0 and
 * 0, and so does an engine where nothing runs, since nothing tells.
 */

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** Each count of the history as the engine answers it: a number, or a failure. */
interface HistoryCounts {
  started: number | FakeReply
  completed: number | FakeReply
}

const FAILURE = { status: 500, body: { type: "ProcessEngineException", message: "boom" } }

/** One process with three running instances and no incident, the history counting as given. */
async function engineWith(counts: HistoryCounts, routes: FakeRoutes) {
  const reply = (count: number | FakeReply) =>
    typeof count === "number" ? { body: { count } } : count
  const engine = await startFakeEngine(
    {
      "GET /incident": { body: [] },
      "GET /process-definition/statistics": {
        body: [
          {
            id: "order:1:d1",
            instances: 3,
            incidents: [],
            definition: { id: "order:1:d1", key: "order", version: 1 },
          },
        ],
      },
      "GET /history/process-instance/count": (r) =>
        reply(r.query.startedAfter === undefined ? counts.completed : counts.started),
      ...routes,
    },
    { body: [] },
  )
  engines.push(engine)
  return { engine, client: clientFor(engine) }
}

/** An instance runs: the runtime lists one. */
const RUNNING = { "GET /process-instance": { body: [{ id: "pi-1" }] } }
/** The history holds a running instance: it is written. */
const OPEN_IN_HISTORY = { "GET /history/process-instance": { body: [{ id: "pi-1" }] } }

/** The reads that ask whether the engine writes history, one row each, by path. */
function historyProbes(engine: FakeEngine) {
  return engine.requests
    .filter((r) => r.path === "/process-instance" || r.path === "/history/process-instance")
    .map((r) => ({ path: r.path, query: r.query }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

async function summaryOf(counts: HistoryCounts, routes: FakeRoutes) {
  const { engine, client } = await engineWith(counts, routes)
  const { summary } = await buildEngineHealthData(client, "fake")
  return { engine, summary }
}

describe("buildEngineHealthData: started and completed in 24 h", () => {
  it("at history level none: both counts unknown and the history unwritten, never 0 and 0", async () => {
    const { engine, summary } = await summaryOf({ started: 0, completed: 0 }, RUNNING)
    expect(summary).toMatchObject({
      runningInstances: 3,
      started24h: null,
      completed24h: null,
      historyRecorded: false,
    })
    expect(historyProbes(engine)).toEqual([
      { path: "/history/process-instance", query: { unfinished: "true", maxResults: "1" } },
      { path: "/process-instance", query: { maxResults: "1" } },
    ])
  })

  it("a quiet day of an engine that writes history stays 0 and 0", async () => {
    const quiet = await summaryOf({ started: 0, completed: 0 }, { ...RUNNING, ...OPEN_IN_HISTORY })
    expect(quiet.summary).toMatchObject({ started24h: 0, completed24h: 0, historyRecorded: true })
    // Nothing runs: nothing tells whether the history is written, so the zeros stand.
    const idle = await summaryOf({ started: 0, completed: 0 }, {})
    expect(idle.summary).toMatchObject({ started24h: 0, completed24h: 0, historyRecorded: null })
  })

  it("a count above 0 proves the history written and asks nothing more", async () => {
    const before = Date.now()
    const { engine, summary } = await summaryOf({ started: 12, completed: 0 }, RUNNING)
    expect(summary).toMatchObject({ started24h: 12, completed24h: 0, historyRecorded: true })
    expect(historyProbes(engine)).toEqual([])
    // Both counts read the same window, the last 24 hours.
    const cutoffs = engine.requests
      .filter((r) => r.path === "/history/process-instance/count")
      .map((r) => engineDateMillis(r.query.startedAfter ?? r.query.finishedAfter))
    expect(cutoffs).toHaveLength(2)
    expect(new Set(cutoffs).size).toBe(1)
    expect(cutoffs[0]).toBeGreaterThanOrEqual(before - DAY_MS - 1000)
    expect(cutoffs[0]).toBeLessThanOrEqual(Date.now() - DAY_MS + 1000)
  })

  it("a failed count beside a 0 still asks: at history level none neither count stays", async () => {
    const failed = await summaryOf({ started: FAILURE, completed: 0 }, RUNNING)
    expect(failed.summary).toMatchObject({
      started24h: null,
      completed24h: null,
      historyRecorded: false,
    })
    expect(historyProbes(failed.engine).map((r) => r.path)).toEqual([
      "/history/process-instance",
      "/process-instance",
    ])
    const otherFailed = await summaryOf({ started: 0, completed: FAILURE }, RUNNING)
    expect(otherFailed.summary).toMatchObject({
      started24h: null,
      completed24h: null,
      historyRecorded: false,
    })
  })

  it("a failed count is unknown and the 0 beside it stays where the history is written", async () => {
    const written = await summaryOf(
      { started: FAILURE, completed: 0 },
      { ...RUNNING, ...OPEN_IN_HISTORY },
    )
    expect(written.summary).toMatchObject({
      started24h: null,
      completed24h: 0,
      historyRecorded: true,
    })
    // Two failed counts leave nothing to ask about.
    const bothFailed = await summaryOf({ started: FAILURE, completed: FAILURE }, RUNNING)
    expect(bothFailed.summary).toMatchObject({
      started24h: null,
      completed24h: null,
      historyRecorded: null,
    })
    expect(historyProbes(bothFailed.engine)).toEqual([])
  })

  it("a failed probe leaves the zeros", async () => {
    const unprobed = await summaryOf(
      { started: 0, completed: 0 },
      { "GET /process-instance": FAILURE },
    )
    expect(unprobed.summary).toMatchObject({
      started24h: 0,
      completed24h: 0,
      historyRecorded: null,
    })
  })
})
