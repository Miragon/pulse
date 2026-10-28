import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@miragon/pulse-camunda7-client/sdk", () => ({
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
} from "@miragon/pulse-camunda7-client/sdk"
import type { Client } from "@miragon/pulse-camunda7-client"
import { buildClusterDetailData } from "./cluster-detail-data.js"
import {
  buildEngineHealthData,
  healthVerdictRule,
  type EngineHealthThresholds,
} from "./health-data.js"

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
    // quoted values masked) — the same shape the engine-health clusters emit.
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

// #340: the verdict states its source so it is not mistaken for analytics_engine_health.
describe("healthVerdictRule", () => {
  it("names the source and the deployment's own thresholds", () => {
    expect(healthVerdictRule({ criticalIncidents: 10, criticalClusterSize: 4 })).toBe(
      "From the engine's open incidents, read live: critical at >=10 open or >=4 in one cluster, degraded with any, else ok.",
    )
  })
})

// Rule text and verdict logic live apart, so each boundary row pins both: a
// flipped comparison would otherwise ship a rule that describes another verdict.
describe("buildEngineHealthData verdict", () => {
  const T: EngineHealthThresholds = { criticalIncidents: 10, criticalClusterSize: 4 }

  /** `sizes[i]` open incidents on activity `A<i>` — one cluster per activity. */
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
    ["one open incident", [1], "degraded"],
    ["total one under the threshold, clusters under theirs", [3, 3, 3], "degraded"],
    ["total AT the threshold, clusters under theirs", [3, 3, 3, 1], "critical"],
    ["one cluster one under its threshold", [3], "degraded"],
    ["one cluster AT its threshold, total far under", [4], "critical"],
  ] as const)("%s → %s", async (_label, sizes, status) => {
    const data = await verdict([...sizes])
    expect(data.status).toBe(status)
    expect(data.statusRule).toBe(healthVerdictRule(T))
  })

  it("judges the engine-wide /count, not the capped scan", async () => {
    const data = await verdict([1, 1], 10)
    expect(data.summary.totalIncidents).toBe(10)
    expect(data.status).toBe("critical")
  })
})
