import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@miragon/pulse-c7-client/sdk", () => ({
  getHistoricProcessInstances: vi.fn(),
  getHistoricProcessInstancesCount: vi.fn(),
  getIncidents: vi.fn(),
  getIncidentsCount: vi.fn(),
  getProcessInstances: vi.fn(),
}))

import {
  getHistoricProcessInstances,
  getHistoricProcessInstancesCount,
  getIncidents,
  getIncidentsCount,
  getProcessInstances,
} from "@miragon/pulse-c7-client/sdk"
import type { Client } from "@miragon/pulse-c7-client"
import {
  causeKeyOf,
  engineVerdict,
  largestCause,
  rootIncidentCounts,
  type VerdictThresholds,
} from "@miragon/pulse-c7-core"
import { buildClusterDetailData } from "./cluster-detail-data.js"
import { CLUSTER_SCAN_LIMIT } from "./cluster-scan.js"
import { buildEngineHealthData, healthVerdictRule } from "./health-data.js"

/**
 * The overview's health verdict (c7-core's, over the open root incidents) and the causes it reads:
 * the clusters, the affected activities and the root incidents, never a call activity's copy.
 * The cluster detail's paging and search are health-data.test.ts's.
 */

const mockedGetIncidents = vi.mocked(getIncidents)

/** The engine's statistics answer, which c7-core reads over its port through the client's `get`. */
const statistics = vi.fn<() => unknown>()
/** A client of each build's own: the server keeps a client's statistics read for 30 s per caller. */
const statisticsClient = () =>
  ({
    get: vi.fn((call: { url: string }) =>
      Promise.resolve(call.url === "/process-definition/statistics" ? statistics() : undefined),
    ),
  }) as unknown as Client
let client: Client

interface IncidentRowFixture {
  id: string
  processDefinitionId: string
  processInstanceId: string
  incidentType: string
  activityId: string
  incidentMessage: string | null
  incidentTimestamp: string
}

beforeEach(() => {
  vi.resetAllMocks()
  client = statisticsClient()
  vi.mocked(getProcessInstances).mockResolvedValue([] as never)
  // Nothing runs: the day's zero counts ask the history in vain, and the zeros stand.
  vi.mocked(getHistoricProcessInstances).mockResolvedValue([] as never)
})

// #340: the verdict states its source and the deployment's thresholds.
describe("healthVerdictRule", () => {
  it("names the source and the deployment's own thresholds", () => {
    expect(healthVerdictRule({ criticalIncidents: 10, criticalClusterSize: 4 })).toBe(
      "From the engine's open root incidents (a copy at a call activity never counts), read live: critical at >=10 open root incidents or >=4 of one cause, warning with any, else ok.",
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

  /** The statistics with `rootIncidents=true`: `count` root incidents of process K1. */
  function rootStatistics(count: number) {
    return [
      {
        id: "K1:1:abc",
        instances: count,
        incidents: count === 0 ? [] : [{ incidentType: "failedJob", incidentCount: count }],
        definition: { id: "K1:1:abc", key: "K1", version: 1 },
      },
    ]
  }

  async function verdict(sizes: number[], roots = sizes.reduce((a, b) => a + b, 0)) {
    mockedGetIncidents.mockResolvedValue(scan(sizes))
    statistics.mockReturnValue(rootStatistics(roots))
    vi.mocked(getHistoricProcessInstancesCount).mockResolvedValue({ count: 0 })
    return buildEngineHealthData(statisticsClient(), "eng1", T)
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
      const openRootIncidents = sizes.reduce((a, b) => a + b, 0)
      expect(data.status).toBe(
        engineVerdict({ openRootIncidents, largestCluster: Math.max(0, ...sizes) }, T),
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
    statistics.mockReturnValue(rootStatistics(4))
    vi.mocked(getHistoricProcessInstancesCount).mockResolvedValue({ count: 0 })
    const data = await buildEngineHealthData(client, "eng1", T)
    expect(largestCause(rows)?.count).toBe(4)
    expect(data.status).toBe("critical")
    expect(data.clusters.map((cluster) => cluster.id)).toEqual([causeKeyOf(rows[0] ?? {}).key])
    expect(data.clusters[0]?.id).toBe("A0::failedJob::boom")
  })

  it("judges the root incidents of the statistics, not the capped scan, and reads no /count", async () => {
    const data = await verdict([1, 1], 10)
    expect(data.status).toBe("critical")
    expect(getIncidentsCount).not.toHaveBeenCalled()
  })
})

/**
 * Camunda 7 copies an incident of a called instance to the call activity above it, without a
 * message: the copy is that failure, never a cause, an activity or an incident of its own (c7-core's
 * `groupIncidents` forms `engine_status`'s groups from root incidents too). The open incidents are
 * the root incidents (docs/vscode/parity.md, "Incident counts"), and the verdict judges them too
 * (owner decision of 2026-11-20): a chain of calls that one failure stops counts it once.
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
    // The statistics with `rootIncidents=true`: the called process's three, none at the caller.
    statistics.mockReturnValue([
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
    ])
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
    expect(vi.mocked(client.get).mock.lastCall?.[0]).toMatchObject({
      url: "/process-definition/statistics",
      query: { rootIncidents: "true" },
    })
  })

  it("judges the root incidents alone, as engine_status judges: a copy raises neither count", async () => {
    const rows = calledFailures(2)
    mockedGetIncidents.mockResolvedValue(rows)
    statistics.mockReturnValue([
      {
        id: "Check:1:c",
        instances: 2,
        incidents: [{ incidentType: "failedJob", incidentCount: 2 }],
        definition: { id: "Check:1:c", key: "Check", version: 1 },
      },
    ])
    vi.mocked(getHistoricProcessInstancesCount).mockResolvedValue({ count: 0 })
    // Four open incidents with the copies, two at the call activity: critical at either.
    const T: VerdictThresholds = { criticalIncidents: 3, criticalClusterSize: 3 }

    const data = await buildEngineHealthData(client, "eng1", T)

    expect(data.status).toBe("warning")
    expect(data.status).toBe(engineVerdict(rootIncidentCounts(2, rows), T))
    expect(engineVerdict({ openRootIncidents: 4, largestCluster: 2 }, T)).toBe("critical")
  })

  it("counts a chain of calls that one failure stops as one root incident", async () => {
    // The label's failed job and Camunda 7's copy of it at each of the four call activities above.
    const root = {
      id: "root",
      rootCauseIncidentId: "root",
      processDefinitionId: "Label:1:x",
      processInstanceId: "label-1",
      incidentType: "failedJob",
      activityId: "PrintLabel",
      incidentMessage: "Printer offline",
      incidentTimestamp: "2026-04-01T00:00:00.000Z",
    }
    const copies = ["Dispatch", "Order", "Customer", "Contract"].map((caller) => ({
      ...root,
      id: `copy-${caller}`,
      processDefinitionId: `${caller}:1:x`,
      processInstanceId: `${caller}-1`,
      activityId: `Call${caller}`,
      incidentMessage: null,
    }))
    mockedGetIncidents.mockResolvedValue([root, ...copies])
    statistics.mockReturnValue([
      {
        id: "Label:1:x",
        instances: 1,
        incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
        definition: { id: "Label:1:x", key: "Label", version: 1 },
      },
    ])
    vi.mocked(getHistoricProcessInstancesCount).mockResolvedValue({ count: 0 })

    const data = await buildEngineHealthData(client, "eng1", {
      criticalIncidents: 2,
      criticalClusterSize: 2,
    })

    expect(data.status).toBe("warning")
    expect(data.summary.totalIncidents).toBe(1)
    expect(data.clusters.map((cluster) => [cluster.activityId, cluster.incidentCount])).toEqual([
      ["PrintLabel", 1],
    ])
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
