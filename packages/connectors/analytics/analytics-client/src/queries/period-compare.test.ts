import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { periodCompare } from "./period-compare.js"
import type { PromSample } from "../prometheus.js"

const NOW = "2026-03-20T12:00:00.000Z"
const NOW_SEC = Date.parse(NOW) / 1000
const DAY = 86_400
const DEPLOY = "2026-03-10T12:00:00.000Z"
const DEPLOY_SEC = Date.parse(DEPLOY) / 1000
const iso = (seconds: number) => new Date(seconds * 1000).toISOString()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.parse(NOW) })
})

afterEach(() => {
  vi.useRealTimers()
})

const v = (value: number): PromSample => ({ metric: {}, value })

const constant = (value: number) =>
  vi.fn<(q: string) => Promise<PromSample[]>>(async () => [v(value)])

/** A week before the deployment against the week after it. */
const aroundDeploy = {
  periodAFrom: iso(DEPLOY_SEC - 7 * DAY),
  periodATo: DEPLOY,
  periodBFrom: DEPLOY,
  periodBTo: iso(DEPLOY_SEC + 7 * DAY),
  minBucketSize: 10,
}

describe("periodCompare", () => {
  it("resolves each period's KPIs from its own historical window, A first", async () => {
    const A = { from: "2026-03-01T12:00:00.000Z", to: "2026-03-02T12:00:00.000Z" }
    const B = { from: "2026-03-10T12:00:00.000Z", to: "2026-03-12T12:00:00.000Z" }
    const atA = `[${DAY}s] @ ${Date.parse(A.to) / 1000}`
    const atB = `[${2 * DAY}s] @ ${Date.parse(B.to) / 1000}`
    const instant = vi.fn(async (q: string): Promise<PromSample[]> => {
      const count = q.includes(atA) ? 10 : 30
      if (q.includes("histogram_quantile(0.5")) return [v(count * 80)]
      if (q.includes("histogram_quantile")) return [v(count * 200)]
      if (q.includes("duration_milliseconds_sum")) return [v(count * 100)]
      if (q.includes("incident_created")) return [v(1)]
      if (q.includes('state="COMPLETED"')) return [v(count - 2)]
      return [v(count)]
    })

    const res = await periodCompare(
      { instant },
      {
        periodAFrom: A.from,
        periodATo: A.to,
        periodBFrom: B.from,
        periodBTo: B.to,
        minBucketSize: 1,
      },
    )

    // Six queries per period, each on its own `[length] @ end` window.
    const sent = instant.mock.calls.map((c) => c[0])
    expect(sent).toHaveLength(12)
    expect(sent.slice(0, 6).every((q) => q.includes(atA))).toBe(true)
    expect(sent.slice(6).every((q) => q.includes(atB))).toBe(true)
    expect(res.kpis).toEqual([
      {
        from: A.from,
        to: A.to,
        days: 1,
        partial: false,
        startedCount: 10,
        startedPerDay: 10,
        completedCount: 8,
        incidentsCreated: 1,
        incidentRatePct: 10,
        elementIncidentsCreated: null,
        elementIncidentRatePct: null,
        avgDurationMs: 1_000,
        medianDurationMs: 800,
        p95DurationMs: 2_000,
      },
      {
        from: B.from,
        to: B.to,
        days: 2,
        partial: false,
        startedCount: 30,
        // Twice the length: per day, B runs 1.5× A, not 3×.
        startedPerDay: 15,
        completedCount: 28,
        incidentsCreated: 1,
        incidentRatePct: 3.3,
        elementIncidentsCreated: null,
        elementIncidentRatePct: null,
        avgDurationMs: 3_000,
        medianDurationMs: 2_400,
        p95DurationMs: 6_000,
      },
    ])
    expect(res.delta).toEqual({
      startedPerDayDeltaPct: 50,
      incidentRateDeltaPp: -6.7,
      elementIncidentRateDeltaPp: null,
      avgDurationDeltaPct: 200,
      p95DurationDeltaPct: 200,
    })
    expect(res).toMatchObject({
      periodAFrom: A.from,
      periodATo: A.to,
      periodBFrom: B.from,
      periodBTo: B.to,
      processDefinitionKey: null,
      activityId: null,
      engines: null,
      partial: false,
    })
  })

  it("anchors both periods at exact epoch seconds via the @ modifier", async () => {
    const instant = constant(20)
    const res = await periodCompare({ instant }, aroundDeploy)

    const queries = instant.mock.calls.map((c) => c[0])
    expect(queries.some((q) => q.includes(`[${7 * DAY}s] @ ${DEPLOY_SEC}`))).toBe(true)
    expect(queries.some((q) => q.includes(`[${7 * DAY}s] @ ${DEPLOY_SEC + 7 * DAY}`))).toBe(true)
    expect(queries.every((q) => !q.includes("NaN"))).toBe(true)
    expect(res.kpis[0].to).toBe(DEPLOY)
    expect(res.kpis[1].from).toBe(DEPLOY)
    expect(res.kpis.map((k) => k.days)).toEqual([7, 7])
    expect(res.partial).toBe(false)
  })

  it("clamps a period reaching past now and reports what was measured (N79)", async () => {
    // Deployed 2 h ago: a 7-day period B would reach 7 days into the future and
    // compare 2 h of data against 7 full days.
    const deployedSec = NOW_SEC - 2 * 3600
    const instant = constant(20)
    const res = await periodCompare(
      { instant },
      {
        ...aroundDeploy,
        periodAFrom: iso(deployedSec - 7 * DAY),
        periodATo: iso(deployedSec),
        periodBFrom: iso(deployedSec),
        periodBTo: iso(deployedSec + 7 * DAY),
      },
    )

    const queries = instant.mock.calls.map((c) => c[0])
    expect(queries.some((q) => q.includes(`[${2 * 3600}s] @ ${NOW_SEC}`))).toBe(true)
    expect(
      queries.every((q) => !/@ (\d+)/.test(q) || Number(/@ (\d+)/.exec(q)![1]) <= NOW_SEC),
    ).toBe(true)
    expect(res.kpis[1]).toMatchObject({ to: NOW, days: 0.08, partial: true })
    expect(res.kpis[0].partial).toBe(false)
    expect(res.partial).toBe(true)
    // 20 starts in 2 h vs 20 in 7 d: per day that is a massive rise, not "+0 %".
    expect(res.delta.startedPerDayDeltaPct).toBeGreaterThan(8000)
  })

  it("clamps the baseline to the retention", async () => {
    const instant = constant(20)
    const res = await periodCompare(
      { instant },
      {
        ...aroundDeploy,
        periodAFrom: "2026-02-11T12:00:00.000Z",
        periodATo: "2026-02-25T12:00:00.000Z",
      },
    )
    // now − 30 d = 2026-02-18T12:00Z: the 14-day baseline keeps only 7 days.
    expect(res.kpis[0]).toMatchObject({
      from: "2026-02-18T12:00:00.000Z",
      days: 7,
      partial: true,
    })
    expect(res.partial).toBe(true)
  })

  it.each([
    // [label, period B, starts, true starts per day]
    ["10 minutes", ["2026-03-15T00:00:00Z", "2026-03-15T00:10:00Z"], 4, 576],
    ["1 hour", ["2026-03-15T00:00:00Z", "2026-03-15T01:00:00Z"], 24, 576],
    // Rounded to 0.00 days this period used to read as "not measured".
    ["5 minutes", ["2026-03-15T00:00:00Z", "2026-03-15T00:05:00Z"], 3, 864],
  ])(
    "rates a %s period's starts per day from its exact length, not the rounded days",
    async (_label, [from, to], starts, perDay) => {
      const atA = `@ ${DEPLOY_SEC}`
      const instant = vi.fn(async (q: string): Promise<PromSample[]> =>
        q.includes("started_total") && !q.includes(atA) ? [v(starts)] : [],
      )
      const res = await periodCompare(
        { instant },
        { ...aroundDeploy, periodBFrom: from, periodBTo: to },
      )
      expect(res.kpis[1].startedPerDay).toBe(perDay)
    },
  )

  it.each([
    [
      "a period B starting in the future",
      { periodBFrom: "2026-03-21T12:00:00.000Z", periodBTo: "2026-03-22T12:00:00.000Z" },
      /^periodB lies in the future: no metrics exist for it yet$/,
    ],
    [
      "a period B starting exactly now",
      { periodBFrom: NOW, periodBTo: "2026-03-27T12:00:00.000Z" },
      /^periodB lies in the future: no metrics exist for it yet$/,
    ],
    [
      "a period A wholly before the retention",
      { periodAFrom: "2026-01-01T00:00:00.000Z", periodATo: "2026-01-02T00:00:00.000Z" },
      /^periodA lies before the 30-day Prometheus retention: its metrics are gone$/,
    ],
    [
      "a reversed period A",
      { periodAFrom: "2026-03-03T00:00:00.000Z", periodATo: "2026-03-01T00:00:00.000Z" },
      /^periodA ends before it starts: swap its from and to$/,
    ],
    [
      "an empty period B",
      { periodBFrom: "2026-03-15T00:00:00.000Z", periodBTo: "2026-03-15T00:00:00.000Z" },
      /^periodB is empty: give it an end after its start$/,
    ],
  ])("refuses %s before any PromQL is sent", async (_label, periods, message) => {
    const instant = vi.fn(async (): Promise<PromSample[]> => [])
    await expect(periodCompare({ instant }, { ...aroundDeploy, ...periods })).rejects.toThrow(
      message,
    )
    expect(instant).not.toHaveBeenCalled()
  })

  it("rejects an unparsable period timestamp before any PromQL is sent", async () => {
    const instant = vi.fn(async (): Promise<PromSample[]> => [])

    await expect(
      periodCompare({ instant }, { ...aroundDeploy, periodAFrom: "last week" }),
    ).rejects.toThrow(/periodAFrom "last week" is not a parseable ISO datetime/)
    expect(instant).not.toHaveBeenCalled()
  })
})
