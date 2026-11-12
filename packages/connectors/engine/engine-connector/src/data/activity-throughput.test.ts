import { afterEach, describe, expect, it, vi } from "vitest"
import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import { oneAtATime } from "../lib/engine/per-engine.js"
import type { RecordedRequest } from "../tools/test-support/fake-engine.js"
import { windowStart } from "./activity-throughput.js"
import {
  build,
  closeEngines,
  countReads,
  engineWith,
  HISTORY,
  HOUR,
  KEY,
  NOW,
  STARTED_AFTER,
  statisticsReads,
  throughput,
  V1,
  V2,
} from "./activity-throughput.test-support.js"

// "Throughput": what the instances started in the last 30 days passed per element.

afterEach(closeEngines)

describe("windowStart", () => {
  it("rounds up to the hour, so the window never spans more than its days", () => {
    expect(new Date(windowStart(NOW, 30)).toISOString()).toBe("2026-10-09T11:00:00.000Z")
    expect(new Date(windowStart(Date.UTC(2026, 10, 8, 10), 30)).toISOString()).toBe(
      "2026-10-09T10:00:00.000Z",
    )
  })

  it("starts a window of 0 days now, never in the future", () => {
    expect(windowStart(NOW, 0)).toBe(NOW)
  })
})

describe("buildActivityStatisticsData (history)", () => {
  it("sums what the window's instances passed per element onto the latest diagram", async () => {
    const { data } = await build()

    expect(data).toEqual({
      processDefinitionKey: KEY,
      source: "history",
      diagramDefinitionId: V2,
      diagramVersion: 2,
      versionCount: 2,
      versionsRead: 2,
      startedAfter: "2026-10-09T11:00:00.000Z",
      windowDays: 30,
      cappedByHistoryTimeToLive: false,
      instanceCount: 42,
      uncountedInstances: 0,
      historyRecorded: true,
      readAt: "2026-11-08T10:30:00.000Z",
      activities: [
        // A pass is a finished activity instance (canceled included); the open ones run there.
        {
          activityId: "assess",
          activityName: "Assess creditworthiness",
          inDiagram: true,
          passed: 40,
          running: 2,
          canceled: 1,
        },
        {
          activityId: "sendPolicy",
          activityName: "Send policy",
          inDiagram: true,
          passed: 30,
          running: 0,
          canceled: 0,
        },
        // Only v1 has it: the latest diagram cannot draw it.
        {
          activityId: "legacyCheck",
          activityName: null,
          inDiagram: false,
          passed: 2,
          running: 0,
          canceled: 2,
        },
      ],
      engineId: "fake",
    })
  })

  it("asks each version's statistics for the window, with finished and canceled", async () => {
    const { engine } = await build()

    const statistics = statisticsReads(engine)
    expect(statistics.map((r) => r.path).sort()).toEqual([
      `/history/process-definition/${V1}/statistics`,
      `/history/process-definition/${V2}/statistics`,
    ])
    for (const r of statistics) {
      expect(r.query).toEqual({ finished: "true", canceled: "true", startedAfter: STARTED_AFTER })
    }
  })

  // A version without an instance in the window costs the engine almost a full read (measured).
  it("reads no statistics for a version that started nothing, and counts only until the key is covered", async () => {
    const versions = [4, 3, 2, 1].map((v) => ({ id: `leasing:${v}:d${v}`, version: v }))
    const { data, engine } = await build({
      versions,
      started: (id) => (id === "leasing:4:d4" ? 9 : id === "leasing:3:d3" ? 1 : 0),
    })

    expect(statisticsReads(engine).map((r) => r.path)).toEqual([
      "/history/process-definition/leasing:4:d4/statistics",
      "/history/process-definition/leasing:3:d3/statistics",
    ])
    // The key's count, then the newest versions until theirs add up to it: v1 is never asked.
    const asked = countReads(engine).map(
      (r) => r.query.processDefinitionId ?? `key ${r.query.processDefinitionKey}`,
    )
    expect(asked[0]).toBe(`key ${KEY}`)
    expect(asked.slice(1).sort()).toEqual(["leasing:2:d2", "leasing:3:d3", "leasing:4:d4"])
    expect(data.versionsRead).toBe(2)
    expect(data.instanceCount).toBe(10)
  })

  it("cuts the window to the shortest history time to live of a version read, and says so", async () => {
    const sevenDays = "2026-11-01T11:00:00.000+0000"
    const { data, engine } = await build({
      versions: [
        { id: V2, version: 2, historyTimeToLive: 7 },
        { id: V1, version: 1, historyTimeToLive: 180 },
      ],
      // v1's two instances started before the last 7 days.
      started: (id, after) =>
        id === V2 ? (after === sevenDays ? 12 : 40) : after === sevenDays ? 0 : 2,
    })

    expect(data).toMatchObject({
      startedAfter: "2026-11-01T11:00:00.000Z",
      windowDays: 7,
      cappedByHistoryTimeToLive: true,
      versionsRead: 1,
      instanceCount: 12,
    })
    expect(statisticsReads(engine).map((r) => [r.path, r.query.startedAfter])).toEqual([
      [`/history/process-definition/${V2}/statistics`, sevenDays],
    ])
  })

  // The cleanup removes what ended before the time to live, so a version with no instance left in
  // the window may still have run there: the latest version when the window began, or a later one.
  it("cuts the window to a version that could have run in it, even when the cleanup left it none", async () => {
    const sevenDays = "2026-11-01T11:00:00.000+0000"
    const { data, engine } = await build({
      versions: [
        { id: V2, version: 2, historyTimeToLive: 180, deployedInWindow: true },
        // The latest when the window began; every instance it started there is cleaned up.
        { id: V1, version: 1, historyTimeToLive: 7 },
      ],
      started: (id, after) => (id === V2 ? (after === sevenDays ? 12 : 40) : 0),
    })

    expect(data).toMatchObject({
      startedAfter: "2026-11-01T11:00:00.000Z",
      windowDays: 7,
      cappedByHistoryTimeToLive: true,
      versionsRead: 1,
      instanceCount: 12,
    })
    expect(engine.requests.find((r) => r.query.deployedAfter)?.query).toEqual({
      key: KEY,
      deployedAfter: STARTED_AFTER,
    })
  })

  it("keeps 30 days when only a version superseded before the window keeps less", async () => {
    const { data } = await build({
      versions: [
        { id: V2, version: 2 },
        { id: V1, version: 1, historyTimeToLive: 1 },
      ],
      started: (id) => (id === V2 ? 40 : 0),
    })

    expect(data).toMatchObject({
      windowDays: 30,
      cappedByHistoryTimeToLive: false,
      versionsRead: 1,
    })
  })

  it("takes the latest version when the window began per tenant", async () => {
    const { data } = await build({
      versions: [
        { id: "leasing:5:a5", version: 5, tenantId: "acme" },
        { id: V2, version: 2, historyTimeToLive: 3 },
        { id: V1, version: 1, historyTimeToLive: 1 },
      ],
      started: (id) => (id === "leasing:5:a5" ? 4 : 0),
    })

    // v2 was the tenant-less latest; v1 was superseded already.
    expect(data).toMatchObject({ windowDays: 3, cappedByHistoryTimeToLive: true })
  })

  it("reads nothing more when a version that could have run in the window keeps no history", async () => {
    const { data, engine } = await build({
      versions: [
        { id: V2, version: 2, historyTimeToLive: 0 },
        { id: V1, version: 1 },
      ],
    })

    expect(data).toMatchObject({
      startedAfter: "2026-11-08T10:30:00.000Z",
      windowDays: 0,
      cappedByHistoryTimeToLive: true,
      versionsRead: 0,
      instanceCount: 0,
      activities: [],
    })
    expect(statisticsReads(engine)).toEqual([])
    expect(engine.requests.map((r) => r.path)).not.toContain("/history/process-instance")
  })

  it("counts six older versions past the likely ones at most, and says how many it left out", async () => {
    const versions = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((v) => ({
      id: `leasing:${v}:d${v}`,
      version: v,
    }))
    const { data, engine } = await build(
      { versions, started: (id) => (id === "leasing:10:d10" ? 5 : 0) },
      {
        // Three more on a deployment deleted without its history: no version holds them.
        "GET /history/process-instance/count": (r: RecordedRequest) => ({
          body: {
            count:
              r.query.processDefinitionId === "leasing:10:d10"
                ? 5
                : r.query.processDefinitionId
                  ? 0
                  : 8,
          },
        }),
        "GET /history/process-definition/leasing:10:d10/statistics": { body: HISTORY[V2] },
      },
    )

    // The likely one (v10, the latest when the window began), then six older ones: never v3 to v1.
    const asked = countReads(engine).flatMap((r) => r.query.processDefinitionId ?? [])
    expect(asked.sort()).toEqual(
      versions
        .slice(0, 7)
        .map((v) => v.id)
        .sort(),
    )
    expect(data).toMatchObject({ versionsRead: 1, instanceCount: 5, uncountedInstances: 3 })
  })

  it("never asks whether the engine writes history once the window holds an instance", async () => {
    const { engine } = await build()

    expect(engine.requests.map((r) => r.path)).not.toContain("/process-instance")
    expect(engine.requests.map((r) => r.path)).not.toContain("/history/process-instance")
  })

  it.each([
    ["an instance runs but none is open in the history", [{ id: "pi-1" }], [], false],
    ["an instance is open in the history", [{ id: "pi-1" }], [{ id: "pi-1" }], true],
    ["nothing runs and nothing is open: unknown", [], [], null],
  ])(
    "tells no history from no traffic when nothing started: %s",
    async (_, running, open, recorded) => {
      const { data, engine } = await build(
        { started: () => 0 },
        {
          "GET /process-instance": { body: running },
          "GET /history/process-instance": { body: open },
        },
      )

      expect(data).toMatchObject({ historyRecorded: recorded, versionsRead: 0, activities: [] })
      expect(engine.requests.find((r) => r.path === "/history/process-instance")?.query).toEqual({
        unfinished: "true",
        maxResults: "1",
      })
      expect(statisticsReads(engine)).toEqual([])
    },
  )

  it("counts no multi-instance body as a pass of its own", async () => {
    const { data } = await build(
      { started: (id) => (id === V2 ? 3 : 0) },
      {
        [`GET /history/process-definition/${V2}/statistics`]: {
          body: [
            { id: "assess#multiInstanceBody", instances: 0, finished: 3, canceled: 0 },
            { id: "assess", instances: 1, finished: 8, canceled: 0 },
          ],
        },
      },
    )

    expect(data.activities).toEqual([
      expect.objectContaining({ activityId: "assess", passed: 8, running: 1 }),
    ])
  })

  it("lists an element the window's instances only reach so far as running, with no pass", async () => {
    const { data } = await build(
      { started: (id) => (id === V2 ? 2 : 0) },
      {
        [`GET /history/process-definition/${V2}/statistics`]: {
          body: [
            { id: "assess", instances: 6, finished: 0, canceled: 0 },
            { id: "sendPolicy", instances: 0, finished: 0, canceled: 0 },
          ],
        },
      },
    )

    expect(data.activities).toEqual([
      expect.objectContaining({ activityId: "assess", passed: 0, running: 6, canceled: 0 }),
    ])
  })
})

describe("buildActivityStatisticsData (history): the load guards", () => {
  it("answers the same key in the same hour from one read, the read's time included", async () => {
    const { engine, client } = await engineWith()
    const first = await throughput(client)
    const reads = engine.requests.length

    const again = await throughput(client, NOW + 20 * 60 * 1000)
    expect(engine.requests).toHaveLength(reads)
    expect(again).toEqual(first)

    // The next hour has a window of its own: read again.
    const nextHour = await throughput(client, NOW + HOUR)
    expect(engine.requests.length).toBeGreaterThan(reads)
    expect(nextHour.readAt).toBe("2026-11-08T11:30:00.000Z")
  })

  it("shares one read between concurrent opens", async () => {
    const { engine, client } = await engineWith()
    await Promise.all([throughput(client), throughput(client)])

    expect(statisticsReads(engine)).toHaveLength(2)
  })

  it("keeps each caller's reads apart", async () => {
    const { engine, client } = await engineWith()
    const as = (authorization: string) =>
      runWithMcpRequestInfo({ authorization }, () => throughput(client))
    await as("Bearer alice")
    await as("Bearer alice")
    await as("Bearer bob")

    expect(statisticsReads(engine)).toHaveLength(4)
  })

  it("does not keep a failed read: the next open asks again", async () => {
    let fail = true
    const { engine, client } = await engineWith(
      {},
      {
        [`GET /history/process-definition/${V1}/statistics`]: () =>
          fail ? { status: 503, body: { message: "busy" } } : { body: HISTORY[V1] },
      },
    )
    await expect(throughput(client)).rejects.toThrow()
    fail = false

    expect((await throughput(client)).versionsRead).toBe(2)
    expect(statisticsReads(engine).length).toBeGreaterThan(2)
  })

  it("reads one statistics at a time per engine, whoever asks", async () => {
    const { engine, client } = await engineWith()
    // Another caller's read holds the engine's turn.
    let release!: () => void
    const held = oneAtATime(client, () => new Promise<void>((resolve) => (release = resolve)))

    const open = throughput(client)
    // The counts are cheap and go ahead; no statistics until the turn is free.
    await vi.waitFor(() => expect(countReads(engine).length).toBeGreaterThan(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(statisticsReads(engine)).toEqual([])

    release()
    await held
    expect((await open).versionsRead).toBe(2)
    expect(statisticsReads(engine)).toHaveLength(2)
  })
})
