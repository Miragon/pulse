import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@miragon/pulse-c7-client/sdk", () => ({
  getHistoricProcessInstancesCount: vi.fn(),
  getIncidents: vi.fn(),
  getIncidentsCount: vi.fn(),
  getProcessDefinitionStatistics: vi.fn(),
  getProcessInstances: vi.fn(),
}))

import { getIncidents, getProcessInstances } from "@miragon/pulse-c7-client/sdk"
import type { Client } from "@miragon/pulse-c7-client"
import { buildClusterDetailData } from "./cluster-detail-data.js"
import { CLUSTER_SCAN_LIMIT } from "./cluster-scan.js"

/**
 * The cluster detail's paging and its search by id; the overview's verdict and the causes it reads
 * from root incidents are health-data.verdict.test.ts's.
 */

const mockedGetIncidents = vi.mocked(getIncidents)
const mockedGetProcessInstances = vi.mocked(getProcessInstances)

const client = {} as Client

interface IncidentRowFixture {
  id: string
  processDefinitionId: string
  processInstanceId: string
  incidentType: string
  activityId: string
  incidentMessage: string | null
  incidentTimestamp: string
}

function incidents(count: number, message = "boom at 'X'"): IncidentRowFixture[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `i${i}`,
    processDefinitionId: "K1:1:abc",
    processInstanceId: `p${i}`,
    incidentType: "failedJob",
    activityId: "A1",
    incidentMessage: message,
    incidentTimestamp: "2026-04-01T00:00:00.000Z",
  }))
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedGetProcessInstances.mockResolvedValue([] as never)
})

describe("buildClusterDetailData paging", () => {
  const args = { activityId: "A1", incidentType: "failedJob" }

  it("returns the default first page of 50 with the full matching total", async () => {
    mockedGetIncidents.mockResolvedValue(incidents(120))

    const data = await buildClusterDetailData(client, "eng1", args)

    expect(data.incidents).toHaveLength(50)
    expect(data.incidents[0]?.incidentId).toBe("i0")
    expect(data.totalMatching).toBe(120)
    expect(data.incidentCount).toBe(120)
  })

  it("slices by firstResult/maxResults over the matching set", async () => {
    mockedGetIncidents.mockResolvedValue(incidents(120))

    const data = await buildClusterDetailData(client, "eng1", {
      ...args,
      firstResult: 100,
      maxResults: 50,
    })

    // Offset past 100 leaves the 20-row tail; the total stays page-independent.
    expect(data.incidents).toHaveLength(20)
    expect(data.incidents[0]?.incidentId).toBe("i100")
    expect(data.totalMatching).toBe(120)
  })

  it("pages the signature-filtered set, not the raw scan", async () => {
    const matching = incidents(60, "timeout calling 'WMS'")
    const other = incidents(40, "NPE in 'Mapper'").map((i, n) => ({
      ...i,
      id: `o${n}`,
      processInstanceId: `q${n}`,
    }))
    // Interleave so a raw-scan slice would pick up foreign rows.
    const mixed = matching.flatMap((m, n) => (other[n] ? [m, other[n]] : [m]))
    mockedGetIncidents.mockResolvedValue(mixed)

    // "timeout calling 'WMS'" normalizes to this signature (lowercased,
    // quoted values masked), the same shape the engine-health clusters emit.
    const data = await buildClusterDetailData(client, "eng1", {
      ...args,
      messageSignature: "timeout calling '<v>'",
      firstResult: 50,
      maxResults: 50,
    })

    expect(data.totalMatching).toBe(60)
    expect(data.incidents).toHaveLength(10)
    expect(data.incidents.every((r) => r.incidentId.startsWith("i"))).toBe(true)
  })

  it("narrows the list (not the KPIs) via the business-key search", async () => {
    mockedGetIncidents.mockResolvedValue(incidents(80))
    // Search lookup: only p3 and p7 carry a matching business key; the later
    // enrichment call returns the keys for the served page.
    mockedGetProcessInstances
      .mockResolvedValueOnce([{ id: "p3" }, { id: "p7" }] as never)
      .mockResolvedValueOnce([
        { id: "p3", businessKey: "ORDER-3" },
        { id: "p7", businessKey: "ORDER-7" },
      ] as never)

    const data = await buildClusterDetailData(client, "eng1", {
      ...args,
      businessKeyLike: "ORDER",
    })

    // The search lookup goes to /process-instance with the substring filter.
    const searchQuery = mockedGetProcessInstances.mock.calls[0]?.[0]?.query as {
      businessKeyLike?: string
    }
    expect(searchQuery.businessKeyLike).toBe("%ORDER%")
    // List + total narrow to the intersection; cluster KPIs stay cluster-wide.
    expect(data.totalMatching).toBe(2)
    expect(data.incidents.map((r) => r.processInstanceId)).toEqual(["p3", "p7"])
    expect(data.incidents[0]?.businessKey).toBe("ORDER-3")
    expect(data.incidentCount).toBe(80)
  })

  it("enriches only the requested page with business keys", async () => {
    mockedGetIncidents.mockResolvedValue(incidents(80))
    mockedGetProcessInstances.mockResolvedValue([{ id: "p50", businessKey: "ORDER-50" }] as never)

    const data = await buildClusterDetailData(client, "eng1", {
      ...args,
      firstResult: 50,
      maxResults: 10,
    })

    expect(mockedGetProcessInstances).toHaveBeenCalledTimes(1)
    const query = mockedGetProcessInstances.mock.calls[0]?.[0]?.query as {
      processInstanceIds?: string
    }
    expect(query.processInstanceIds?.split(",")).toHaveLength(10)
    expect(query.processInstanceIds?.startsWith("p50")).toBe(true)
    expect(data.incidents[0]?.businessKey).toBe("ORDER-50")
  })
})

/** A called instance has no business key: the search finds a row by its ids too. */
describe("buildClusterDetailData search by id", () => {
  const args = { activityId: "A1", incidentType: "failedJob" }

  it("finds a row by a part of its instance's id, a pasted id whole, and its incident's id", async () => {
    mockedGetIncidents.mockResolvedValue(incidents(20))

    const byPart = await buildClusterDetailData(client, "eng1", { ...args, businessKeyLike: "P1" })
    // p1 and p10 to p19 hold "p1"; case is ignored, as the business key's search.
    expect(byPart.incidents.map((row) => row.processInstanceId)).toEqual([
      "p1",
      ...Array.from({ length: 10 }, (_, n) => `p1${n}`),
    ])
    expect(byPart.totalMatching).toBe(11)
    // The KPIs keep describing the whole cluster.
    expect(byPart.incidentCount).toBe(20)

    const whole = await buildClusterDetailData(client, "eng1", { ...args, businessKeyLike: " p7 " })
    expect(whole.incidents.map((row) => row.processInstanceId)).toEqual(["p7"])

    const incident = await buildClusterDetailData(client, "eng1", {
      ...args,
      businessKeyLike: "i19",
    })
    expect(incident.incidents.map((row) => row.incidentId)).toEqual(["i19"])
  })

  it("reads a % as the business key's LIKE does, any run of characters", async () => {
    mockedGetIncidents.mockResolvedValue(incidents(20))

    const data = await buildClusterDetailData(client, "eng1", { ...args, businessKeyLike: "p%5" })
    expect(data.incidents.map((row) => row.processInstanceId)).toEqual(["p5", "p15"])

    const nothing = await buildClusterDetailData(client, "eng1", { ...args, businessKeyLike: "%" })
    expect(nothing.incidents).toEqual([])
  })

  it("finds the parts between % in order, the first at the id's start, the last at its end", async () => {
    mockedGetIncidents.mockResolvedValue(incidents(20))

    // A run of % is one: p1, then anything.
    const run = await buildClusterDetailData(client, "eng1", {
      ...args,
      businessKeyLike: "p%%1%%%",
    })
    expect(run.incidents.map((row) => row.processInstanceId)).toEqual([
      "p1",
      ...Array.from({ length: 10 }, (_, n) => `p1${n}`),
    ])
    // The last part never overlaps the first: p1 is no "p1%1", p11 is.
    const ends = await buildClusterDetailData(client, "eng1", { ...args, businessKeyLike: "P1%1" })
    expect(ends.incidents.map((row) => row.processInstanceId)).toEqual(["p11"])
    // A middle part lies between them: "%1%1%" holds two 1s.
    const twice = await buildClusterDetailData(client, "eng1", {
      ...args,
      businessKeyLike: "%1%1%",
    })
    expect(twice.incidents.map((row) => row.processInstanceId)).toEqual(["p11"])
  })

  /** Ids as the engine's: UUIDs, none of which holds a "z". */
  function uuidRows(count: number): IncidentRowFixture[] {
    const uuid = (n: number, tail: string) =>
      `${n.toString(16).padStart(8, "0")}-9b7d-11ef-8c2a-${tail}`
    return incidents(count).map((row, n) => ({
      ...row,
      id: uuid(n, "0242ac120002"),
      processInstanceId: uuid(n, "0242ac130002"),
    }))
  }

  // The term is the viewer's: a run of % before a letter no id holds made a backtracking pattern
  // take seconds per id from eight % on, synchronously on the server's one event loop. A run of %
  // reads as one: the three reads of 100,000 % over the scan's ids take 50 to 70 ms alone, up to
  // 30 times that while `pnpm test` runs every package's suite at once; a matcher that seeks each
  // % on its own takes about 15 s alone on these ids, so 5 s still tells the two apart (at 10,000
  // %, 0.9 s alone, nothing did). The case's timeout sits above the bound, so the bound fails it.
  const PERCENTS_BOUND_MS = 5_000

  it(
    "reads a term of many % in one pass over each id, a long one as fast as a short one",
    { timeout: 2 * PERCENTS_BOUND_MS },
    async () => {
      mockedGetIncidents.mockResolvedValue(uuidRows(4))
      let started = performance.now()
      const eight = await buildClusterDetailData(client, "eng1", {
        ...args,
        businessKeyLike: `${"%".repeat(8)}z`,
      })
      expect(eight.incidents).toEqual([])
      // Alone 3 to 4 ms, so 30 times that fits; the backtracking pattern takes 2 s on one id.
      expect(performance.now() - started).toBeLessThan(250)

      const rows = uuidRows(CLUSTER_SCAN_LIMIT - 1)
      mockedGetIncidents.mockResolvedValue(rows)
      const percents = "%".repeat(100_000)
      started = performance.now()
      const none = await buildClusterDetailData(client, "eng1", {
        ...args,
        businessKeyLike: `${percents}z`,
      })
      const allPercent = await buildClusterDetailData(client, "eng1", {
        ...args,
        businessKeyLike: percents,
      })
      const tail = await buildClusterDetailData(client, "eng1", {
        ...args,
        businessKeyLike: `${percents}0002${percents}`,
      })
      expect(performance.now() - started).toBeLessThan(PERCENTS_BOUND_MS)
      expect(none.totalMatching).toBe(0)
      expect(allPercent.totalMatching).toBe(0)
      expect(tail.totalMatching).toBe(rows.length)
    },
  )
})
