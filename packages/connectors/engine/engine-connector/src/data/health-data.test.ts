import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@miragon/pulse-c7-client/sdk", () => ({
  getHistoricProcessInstancesCount: vi.fn(),
  getIncidents: vi.fn(),
  getIncidentsCount: vi.fn(),
  getProcessDefinitionStatistics: vi.fn(),
  getProcessInstances: vi.fn(),
}))

import {
  getHistoricProcessInstancesCount,
  getIncidents,
  getIncidentsCount,
  getProcessDefinitionStatistics,
  getProcessInstances,
} from "@miragon/pulse-c7-client/sdk"
import type { Client } from "@miragon/pulse-c7-client"
import { buildClusterDetailData } from "./cluster-detail-data.js"
import { CLUSTER_SCAN_LIMIT } from "./cluster-scan.js"
import {
  causeKeyOf,
  engineVerdict,
  largestCause,
  type VerdictThresholds,
} from "@miragon/pulse-c7-core"
import { buildEngineHealthData, healthVerdictRule } from "./health-data.js"

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

// #340: the verdict states its source and the deployment's thresholds.
describe("healthVerdictRule", () => {
  it("names the source and the deployment's own thresholds", () => {
    expect(healthVerdictRule({ criticalIncidents: 10, criticalClusterSize: 4 })).toBe(
      "From the engine's open incidents, copies at call activities included, read live: critical at >=10 open incidents or >=4 of one cause, warning with any, else ok.",
    )
  })
})

// Rule text and verdict logic live apart, so each boundary row pins both: a
// flipped comparison would otherwise ship a rule that describes another verdict.
describe("buildEngineHealthData verdict", () => {
  const T: VerdictThresholds = { criticalIncidents: 10, criticalClusterSize: 4 }

  /** `sizes[i]` open incidents on activity `A<i>`: one cluster per activity. */
  function scan(sizes: number[]): IncidentRowFixture[] {
    return sizes.flatMap((size, cluster) =>
      Array.from({ length: size }, (_, i) => ({
        id: `i${cluster}-${i}`,
        processDefinitionId: "K1:1:abc",
        processInstanceId: `p${cluster}-${i}`,
        incidentType: "failedJob",
        activityId: `A${cluster}`,
        incidentMessage: "boom",
        incidentTimestamp: "2026-04-01T00:00:00.000Z",
      })),
    )
  }

  async function verdict(sizes: number[], count = sizes.reduce((a, b) => a + b, 0)) {
    mockedGetIncidents.mockResolvedValue(scan(sizes))
    vi.mocked(getIncidentsCount).mockResolvedValue({ count })
    vi.mocked(getProcessDefinitionStatistics).mockResolvedValue([] as never)
    vi.mocked(getHistoricProcessInstancesCount).mockResolvedValue({ count: 0 })
    return buildEngineHealthData(client, "eng1", T)
  }

  it.each([
    ["no open incident", [], "ok"],
    ["one open incident", [1], "warning"],
    ["total one under the threshold, clusters under theirs", [3, 3, 3], "warning"],
    ["total AT the threshold, clusters under theirs", [3, 3, 3, 1], "critical"],
    ["one cluster one under its threshold", [3], "warning"],
    ["one cluster AT its threshold, total far under", [4], "critical"],
  ] as const)("%s → %s", async (_label, sizes, status) => {
    const data = await verdict([...sizes])
    expect(data.status).toBe(status)
    expect(data.statusRule).toBe(healthVerdictRule(T))
  })

  it("is c7-core's verdict, the one engine_status gives", async () => {
    for (const sizes of [[], [1], [3, 3, 3], [3, 3, 3, 1], [3], [4], [2, 2]]) {
      const data = await verdict(sizes)
      const openIncidents = sizes.reduce((a, b) => a + b, 0)
      expect(data.status).toBe(
        engineVerdict({ openIncidents, largestCluster: Math.max(0, ...sizes) }, T),
      )
    }
  })

  it("counts one cause across definitions, c7-core's largestCause, as engine_status does", async () => {
    // 2 + 2 incidents of one activity, type and message in two definitions: one cause of 4
    const rows = [
      ...scan([2]),
      ...scan([2]).map((row) => ({ ...row, processDefinitionId: "K2:1:x" })),
    ]
    mockedGetIncidents.mockResolvedValue(rows)
    vi.mocked(getIncidentsCount).mockResolvedValue({ count: 4 })
    vi.mocked(getProcessDefinitionStatistics).mockResolvedValue([] as never)
    vi.mocked(getHistoricProcessInstancesCount).mockResolvedValue({ count: 0 })
    const data = await buildEngineHealthData(client, "eng1", T)
    expect(largestCause(rows)?.count).toBe(4)
    expect(data.status).toBe("critical")
    expect(data.clusters.map((cluster) => cluster.id)).toEqual([causeKeyOf(rows[0] ?? {}).key])
    expect(data.clusters[0]?.id).toBe("A0::failedJob::boom")
  })

  it("judges the engine-wide /count, not the capped scan", async () => {
    const data = await verdict([1, 1], 10)
    expect(data.status).toBe("critical")
  })
})

/**
 * Camunda 7 copies an incident of a called instance to the call activity above it, without a
 * message: the copy is that failure, never a cause, an activity or an incident of its own (c7-core's
 * `groupIncidents` forms `engine_status`'s groups from root incidents too). The open incidents are
 * the root incidents (docs/vscode/parity.md, "Incident counts"); the verdict alone still judges
 * every open incident, copies included, until its own step.
 */
describe("causes from root incidents alone", () => {
  /** `count` failures in a called process, each with its copy at the caller's call activity. */
  function calledFailures(count: number) {
    return Array.from({ length: count }, (_, n) => [
      {
        id: `root-${n}`,
        rootCauseIncidentId: `root-${n}`,
        processDefinitionId: "Check:1:c",
        processInstanceId: `called-${n}`,
        incidentType: "failedJob",
        activityId: "CheckBlacklist",
        incidentMessage: "Blacklist provider unreachable",
        incidentTimestamp: "2026-04-01T00:00:00.000Z",
      },
      {
        id: `copy-${n}`,
        rootCauseIncidentId: `root-${n}`,
        processDefinitionId: "Leasing:1:l",
        processInstanceId: `caller-${n}`,
        incidentType: "failedJob",
        activityId: "CallCheck",
        incidentMessage: null,
        incidentTimestamp: "2026-04-01T00:00:00.000Z",
      },
    ]).flat()
  }

  it("the overview names the called process's failure once, its copies no cause, no incident", async () => {
    const rows = calledFailures(3)
    mockedGetIncidents.mockResolvedValue(rows)
    vi.mocked(getIncidentsCount).mockResolvedValue({ count: 6 })
    // The statistics with `rootIncidents=true`: the called process's three, none at the caller.
    vi.mocked(getProcessDefinitionStatistics).mockResolvedValue([
      {
        id: "Check:1:c",
        instances: 3,
        incidents: [{ incidentType: "failedJob", incidentCount: 3 }],
        definition: { id: "Check:1:c", key: "Check", version: 1 },
      },
      {
        id: "Leasing:1:l",
        instances: 3,
        incidents: [],
        definition: { id: "Leasing:1:l", key: "Leasing", version: 1 },
      },
    ] as never)
    vi.mocked(getHistoricProcessInstancesCount).mockResolvedValue({ count: 0 })

    const data = await buildEngineHealthData(client, "eng1")

    expect(data.clusters.map((c) => [c.activityId, c.incidentCount])).toEqual([
      ["CheckBlacklist", 3],
    ])
    expect(data.clusters[0]?.representativeMessage).toBe("Blacklist provider unreachable")
    // Three root incidents at one activity of one process; with the copies: six at two in two.
    expect(data.summary.totalIncidents).toBe(3)
    expect(data.summary.affectedActivities).toBe(1)
    expect(data.summary.affectedDefinitions).toBe(1)
    expect(vi.mocked(getProcessDefinitionStatistics).mock.lastCall?.[0]?.query).toMatchObject({
      rootIncidents: true,
    })
  })

  it("keeps the verdict c7-core's over every scanned incident, as engine_status judges", async () => {
    const rows = calledFailures(2)
    mockedGetIncidents.mockResolvedValue(rows)
    vi.mocked(getIncidentsCount).mockResolvedValue({ count: 4 })
    vi.mocked(getProcessDefinitionStatistics).mockResolvedValue([] as never)
    vi.mocked(getHistoricProcessInstancesCount).mockResolvedValue({ count: 0 })
    const T: VerdictThresholds = { criticalIncidents: 10, criticalClusterSize: 2 }

    const data = await buildEngineHealthData(client, "eng1", T)

    expect(data.status).toBe(
      engineVerdict({ openIncidents: 4, largestCluster: largestCause(rows)?.count ?? 0 }, T),
    )
  })

  it("a cluster lists its root incidents, never the copies at a call activity", async () => {
    const rows = calledFailures(3)
    // The engine filters by the activity.
    mockedGetIncidents.mockImplementation((options) =>
      Promise.resolve(rows.filter((row) => row.activityId === options?.query?.activityId) as never),
    )

    const copies = await buildClusterDetailData(client, "eng1", {
      activityId: "CallCheck",
      incidentType: "failedJob",
    })
    expect(copies.incidents).toEqual([])
    expect(copies.incidentCount).toBe(0)

    const roots = await buildClusterDetailData(client, "eng1", {
      activityId: "CheckBlacklist",
      incidentType: "failedJob",
    })
    expect(roots.incidents.map((row) => row.incidentId)).toEqual(["root-0", "root-1", "root-2"])
    expect(roots.incidentCount).toBe(3)
  })

  it("a capped scan with copies in it counts none from /incident/count, which would count them", async () => {
    // A call activity that failed itself (a root) and holds copies, past the scan's limit.
    const rows = Array.from({ length: CLUSTER_SCAN_LIMIT }, (_, n) => ({
      id: `i${n}`,
      rootCauseIncidentId: n % 2 === 0 ? `i${n}` : "elsewhere",
      processDefinitionId: "K1:1:abc",
      processInstanceId: `p${n}`,
      incidentType: "failedJob",
      activityId: "A1",
      incidentMessage: null,
      incidentTimestamp: "2026-04-01T00:00:00.000Z",
    }))
    mockedGetIncidents.mockResolvedValue(rows)

    const data = await buildClusterDetailData(client, "eng1", {
      activityId: "A1",
      incidentType: "failedJob",
    })

    expect(getIncidentsCount).not.toHaveBeenCalled()
    expect(data.incidentCount).toBeNull()
    expect(data.scannedIncidentCount).toBe(CLUSTER_SCAN_LIMIT / 2)
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
  // take seconds per id from eight % on, synchronously on the server's one event loop.
  it("reads a term of many % in one pass over each id, a long one as fast as a short one", async () => {
    mockedGetIncidents.mockResolvedValue(uuidRows(4))
    let started = performance.now()
    const eight = await buildClusterDetailData(client, "eng1", {
      ...args,
      businessKeyLike: `${"%".repeat(8)}z`,
    })
    expect(eight.incidents).toEqual([])
    expect(performance.now() - started).toBeLessThan(250)

    const rows = uuidRows(CLUSTER_SCAN_LIMIT - 1)
    mockedGetIncidents.mockResolvedValue(rows)
    const percents = "%".repeat(10_000)
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
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(none.totalMatching).toBe(0)
    expect(allPercent.totalMatching).toBe(0)
    expect(tail.totalMatching).toBe(rows.length)
  })
})
