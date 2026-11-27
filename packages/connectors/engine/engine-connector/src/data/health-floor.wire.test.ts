/**
 * The health floor on the wire (F123): the chat's health answers again while the statistics read
 * it was built on answers, so a Refresh within 30 s reads nothing at all, and its bar names that
 * read's time, never a later one; its build sends the scan and the day's counts beside that read;
 * another caller and a renewed token build their own, and neither a failed build nor one that
 * misses a part (a failed enrichment, a diagram read it joined that failed, a refused body) is kept.
 */

import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-c7-core"
import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveEngine } from "../lib/engine/resolve-engine.js"
import { ENGINE_FAILURE, WORLD, worldReply } from "../tools/test-support/engine-world.js"
import {
  type FakeEngine,
  type FakeReply,
  type RecordedRequest,
  registryFor,
  startFakeEngine,
} from "../tools/test-support/fake-engine.js"
import { healthFeed, overviewFeed } from "./feeds.js"
import { STATISTICS_FLOOR_MS } from "./statistics-floor.js"

const NOW = Date.parse("2026-11-27T09:00:00.000Z")
const CTX = { healthThresholds: DEFAULT_VERDICT_THRESHOLDS }
const STATISTICS = "/process-definition/statistics"
const DAY_COUNTS = "/history/process-instance/count"
const LATEST_XML = `/process-definition/${WORLD.latestDefinitionId}/xml`

/** A reply the fake engine sends now, or later: a test holds a read open to see what is in flight. */
type Answer = (request: RecordedRequest) => FakeReply | undefined | Promise<FakeReply | undefined>

/** The world's versions without names, its root incident on the latest: both views read its diagram. */
function unnamedOnLatest(request: RecordedRequest): FakeReply | undefined {
  if (request.path === STATISTICS) {
    const rows = worldReply(request).body as { definition: object }[]
    return { body: rows.map((row) => ({ ...row, definition: { ...row.definition, name: null } })) }
  }
  if (request.path !== "/incident") return undefined
  const [root] = worldReply(request).body as object[]
  return { body: [{ ...root, processDefinitionId: WORLD.latestDefinitionId }] }
}

/** A promise the test settles, and the call that settles it. */
function held() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const engines: FakeEngine[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** The world as one configured engine: each call resolves it anew, as an MCP request does. */
async function worldEngine(answer?: Answer) {
  const engine = await startFakeEngine(
    {},
    async (request) => (await answer?.(request)) ?? worldReply(request),
  )
  engines.push(engine)
  const registry = registryFor(engine)
  const health = () => healthFeed.read({}, resolveEngine("fake", registry), CTX)
  const reads = (path: string) => engine.requests.filter((r) => r.path === path).length
  return { engine, registry, health, reads }
}

describe("the chat's health for 30 s per engine and caller", () => {
  it("answers a Refresh from its build and names the statistics read's time", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    const { engine, registry, health, reads } = await worldEngine()
    // The overview reads the statistics first; the health built later counts that read.
    await overviewFeed.read({}, resolveEngine("fake", registry), CTX)
    vi.setSystemTime(NOW + 10_000)
    const first = await health()
    expect(first.fetchedAt).toBe(new Date(NOW).toISOString())
    const sent = engine.requests.length

    vi.setSystemTime(NOW + STATISTICS_FLOOR_MS - 1)
    expect(await health()).toBe(first)
    expect(engine.requests).toHaveLength(sent)

    // The statistics read is past its 30 s: the health builds anew on a new one.
    vi.setSystemTime(NOW + STATISTICS_FLOOR_MS)
    const second = await health()
    expect(second.fetchedAt).toBe(new Date(NOW + STATISTICS_FLOOR_MS).toISOString())
    expect(reads("/process-definition/statistics")).toBe(2)
    expect(reads("/incident")).toBe(2)
  })

  it("builds anew for another caller and for a renewed token", async () => {
    const { health, reads } = await worldEngine()
    const as = (user: string, token: string) =>
      runWithMcpRequestInfo({ authUserId: user, authorization: `Bearer ${token}` }, health)
    const first = await as("ada", "first")
    expect(await as("ada", "first")).toBe(first)
    expect(reads("/incident")).toBe(1)
    expect(await as("ada", "renewed")).not.toBe(first)
    expect(await as("bob", "first")).not.toBe(first)
    expect(reads("/incident")).toBe(3)
    expect(reads("/process-definition/statistics")).toBe(3)
  })

  it("keeps no build an enrichment read is missing from", async () => {
    let failing = true
    const { health, reads } = await worldEngine((r) =>
      r.path === "/history/process-instance/count" && failing ? ENGINE_FAILURE : undefined,
    )
    const partial = await health()
    expect(partial.summary.started24h).toBeNull()
    failing = false
    const whole = await health()
    expect(whole.summary.started24h).toBe(1)
    expect(await health()).toBe(whole)
    expect(reads("/incident")).toBe(2)
    // The statistics read answered whole: the second build counts it again, never reads it anew.
    expect(reads("/process-definition/statistics")).toBe(1)
  })

  it("sends the scan and the day's counts while the statistics read is still open", async () => {
    const statistics = held()
    const { health, reads } = await worldEngine(async (r) => {
      if (r.path === STATISTICS) await statistics.promise
      return undefined
    })
    const answer = health()
    // The build waits for no read to send another: all of them are out at once.
    await vi.waitFor(() => {
      expect(reads("/incident")).toBe(1)
      expect(reads(DAY_COUNTS)).toBe(2)
    })
    expect(reads(STATISTICS)).toBe(1)
    statistics.release()
    expect((await answer).summary).toMatchObject({ totalIncidents: 1, started24h: 1 })
  })

  it("keeps no build whose day counts answered a body it refused", async () => {
    let refusing = true
    const { health, reads } = await worldEngine((r) =>
      r.path === DAY_COUNTS && refusing ? { body: {} } : undefined,
    )
    expect((await health()).summary.started24h).toBeNull()
    refusing = false
    const whole = await health()
    expect(whole.summary.started24h).toBe(1)
    expect(await health()).toBe(whole)
    expect(reads(DAY_COUNTS)).toBe(4)
  })

  it("keeps no build whose question whether the engine writes history failed", async () => {
    let failing = true
    const { health } = await worldEngine((r) => {
      // Two counts of 0 ask whether the engine writes history at all.
      if (r.path === DAY_COUNTS) return { body: { count: 0 } }
      return r.path === "/history/process-instance" && failing ? ENGINE_FAILURE : undefined
    })
    expect((await health()).summary.historyRecorded).toBeNull()
    failing = false
    const whole = await health()
    expect(whole.summary.historyRecorded).toBe(true)
    expect(await health()).toBe(whole)
  })

  it("keeps no build whose diagram read failed in the overview's read it joined", async () => {
    const diagram = held()
    let failing = true
    const { registry, health, reads } = await worldEngine(async (r) => {
      if (r.path !== LATEST_XML || !failing) return unnamedOnLatest(r)
      await diagram.promise
      return ENGINE_FAILURE
    })
    // The overview names its unnamed process by the latest version's diagram: that read is out.
    const overview = overviewFeed.read({}, resolveEngine("fake", registry), CTX)
    await vi.waitFor(() => expect(reads(LATEST_XML)).toBe(1))
    // The health names its cause by the same diagram and joins that read, which then fails.
    const partial = health()
    await vi.waitFor(() => expect(reads(DAY_COUNTS)).toBe(2))
    await settle(200)
    diagram.release()
    const [first] = await Promise.all([partial, overview])
    expect(first.clusters[0]?.activityName).toBeNull()
    expect(reads(LATEST_XML)).toBe(1)

    failing = false
    const again = await health()
    expect(again.clusters[0]?.activityName).toBe("Charge card")
    expect(reads(LATEST_XML)).toBe(2)
  })

  it("keeps no failed build: the next call builds again", async () => {
    let failing = true
    const { health, reads } = await worldEngine((r) =>
      r.path === "/incident" && failing ? ENGINE_FAILURE : undefined,
    )
    await expect(health()).rejects.toThrow()
    failing = false
    expect((await health()).summary.totalIncidents).toBe(1)
    expect(reads("/incident")).toBe(2)
  })
})
