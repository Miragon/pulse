import { describe, expect, it } from "vitest"
import {
  defaultGroupOrder,
  definitionStatus,
  groupIncidents,
  jobStatus,
  topicStatus,
  unknownKeys,
} from "./status.js"
import { definitionStatisticsOf } from "./definition-statistics.js"
import { messageSignature } from "./message-signature.js"
import { NOW, statistics } from "./testing/status.js"

const incident = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  rootCauseIncidentId: id,
  incidentType: "failedJob",
  activityId: "book",
  processDefinitionId: "order:1:x",
  processInstanceId: `pi-${id}`,
  incidentMessage: `Job ${id} failed`,
  incidentTimestamp: "2026-01-01T10:00:00.000+0000",
  ...overrides,
})

describe("groupIncidents", () => {
  it("groups root incidents with their next step; propagated ones are counted", () => {
    const grouped = groupIncidents(
      [
        incident("1"),
        incident("2", { incidentTimestamp: "2026-01-01T11:00:00.000+0000" }),
        incident("3", { rootCauseIncidentId: "1" }),
        incident("4", { incidentType: "custom", activityId: "pay" }),
      ],
      definitionStatisticsOf([statistics("order", 1, [1, 1, 1])]),
    )
    expect(grouped.propagated).toBe(1)
    expect(grouped.groups.map((group) => [group.count, group.type, group.next])).toEqual([
      [
        2,
        "failedJob",
        { action: "retryActivity", processDefinitionKey: "order", activityId: "book" },
      ],
      [
        1,
        "custom",
        { action: "listIncidentsAtActivity", processDefinitionKey: "order", activityId: "pay" },
      ],
    ])
    expect(grouped.groups[0]).toMatchObject({
      firstAt: "2026-01-01T10:00:00.000+0000",
      lastAt: "2026-01-01T11:00:00.000+0000",
      processInstanceIds: ["pi-2", "pi-1"],
    })
  })

  it("groups an incident without a root incident as a root, by the family's root rule", () => {
    const grouped = groupIncidents(
      [
        incident("1", { rootCauseIncidentId: undefined }),
        incident("2", { rootCauseIncidentId: "" }),
      ],
      definitionStatisticsOf([statistics("order", 1, [2, 2, 2])]),
    )
    expect(grouped.propagated).toBe(0)
    expect(grouped.groups.map((group) => group.count)).toEqual([2])
  })

  it("groups by the family's message signature, the one the cockpit's clusters use", () => {
    const message = (incidentMessage: string) => ({ incidentMessage })
    const grouped = groupIncidents(
      [
        // one cause: case, whitespace, quoted values and numbers differ
        incident("1", message("Timeout calling 'https://a.example/1' after 30000 ms")),
        incident("2", message("timeout  calling 'https://b.example/2' after 5000 ms")),
        incident("3", message('TIMEOUT calling "svc" after 7 ms')),
        // another cause at the same activity
        incident("4", message("Connection refused calling 'https://a.example/1'")),
      ],
      definitionStatisticsOf([statistics("order", 1, [4, 4, 4])]),
    )
    expect(grouped.groups.map((group) => group.count)).toEqual([2, 1, 1])
    expect(grouped.groups[0]?.processInstanceIds).toEqual(["pi-1", "pi-2"])
    expect(grouped.groups.map((group) => messageSignature(group.message))).toEqual([
      "timeout calling '<v>' after <n> ms",
      'timeout calling "<v>" after <n> ms',
      "connection refused calling '<v>'",
    ])
  })

  it("names the job definition or the type of incidents outside any process definition", () => {
    const grouped = groupIncidents(
      [
        incident("1", { processDefinitionId: null, jobDefinitionId: "jd-cleanup" }),
        incident("2", { processDefinitionId: null, incidentType: "custom", activityId: "x" }),
        incident("3", { processDefinitionId: null, jobDefinitionId: "jd-batch" }),
      ],
      [],
      new Set(["jd-batch"]),
    )
    expect(grouped.groups.map((group) => group.next)).toEqual([
      { action: "listFailedJobs", jobDefinitionId: "jd-cleanup" },
      { action: "listIncidentsOfType", incidentType: "custom" },
    ])
  })

  it("breaks ties with the step order, by default action, key, activity, type, job definition", () => {
    const tied = [incident("1", { activityId: "b" }), incident("2", { activityId: "a" })]
    expect(groupIncidents(tied, []).groups.map((group) => group.activityId)).toEqual(["a", "b"])
    const reversed = groupIncidents(tied, [], new Set(), (left, right) =>
      defaultGroupOrder(right, left),
    )
    expect(reversed.groups.map((group) => group.activityId)).toEqual(["b", "a"])
    expect(
      defaultGroupOrder(
        { action: "listFailedJobs", jobDefinitionId: "a" },
        { action: "listFailedJobs", jobDefinitionId: "b" },
      ),
    ).toBe(-1)
    expect(
      defaultGroupOrder(
        { action: "listFailedJobs" },
        { action: "listIncidentsOfType", incidentType: "x" },
      ),
    ).toBe(-1)
  })
})

describe("the other status reads", () => {
  it("sums definitions and finds unknown keys", () => {
    const rows = definitionStatisticsOf([
      statistics("order", 1, [2, 0, 0]),
      statistics("order", 2, [1, 1, 1]),
    ])
    expect(definitionStatus(rows, [])).toEqual([
      {
        key: "order",
        name: "order v2",
        latestVersion: 2,
        versions: 2,
        instances: 3,
        failedJobs: 1,
        incidents: 1,
      },
    ])
    expect(unknownKeys(rows, ["order", "nope"])).toEqual(["nope"])
  })

  it("leaves out keys without instances, failed jobs and incidents unless named, and sorts", () => {
    const rows = definitionStatisticsOf([
      statistics("idle", 1, [0, 0, 0]),
      statistics("run", 1, [3, 0, 0]),
      statistics("calm", 1, [3, 0, 0]),
      statistics("fail", 1, [1, 2, 0]),
      statistics("inc", 1, [1, 1, 1]),
      statistics("jobs", 1, [0, 1, 0]),
    ])
    const keys = (named: readonly string[]) => definitionStatus(rows, named).map(({ key }) => key)
    // incidents, then failed jobs, then instances, then the key
    expect(keys([])).toEqual(["inc", "fail", "jobs", "calm", "run"])
    expect(keys(["idle", "run"])).toEqual(["run", "idle"])
  })

  it("keys an incident by its version in the statistics, a bare generated id too", () => {
    const bare = "6f1c2a9e-0b7d-4c33-9a51-3d2e8f40b7aa"
    const rows = definitionStatisticsOf([
      { instances: 1, definition: { id: bare, key: "longProcessKey", version: 1 } },
    ])
    const incident = { id: "i1", rootCauseIncidentId: "i1", processDefinitionId: bare }
    const grouped = groupIncidents([incident], rows)
    expect(grouped.groups.map((group) => group.processDefinitionKey)).toEqual(["longProcessKey"])
  })

  it("partitions external tasks per topic and finds overdue jobs", () => {
    const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
    const topics = topicStatus(
      [
        { topicName: "mail", createTime: at(-30) },
        { topicName: "mail", lockExpirationTime: at(5), workerId: "w1" },
        { topicName: "mail", lockExpirationTime: at(-5) },
        { topicName: "mail", retries: 0 },
        { topicName: "mail", errorMessage: "x", lockExpirationTime: at(-1), createTime: at(-60) },
      ],
      NOW,
    )
    expect(topics).toEqual([
      {
        topic: "mail",
        waiting: 2,
        locked: 1,
        lockExpired: 1,
        failed: 1,
        workers: ["w1"],
        oldestWaitingSince: at(-30),
        oldestLockExpiredAt: at(-5),
      },
    ])
    expect(
      jobStatus(4, [{ dueDate: at(-10) }, { createTime: at(-20) }, { dueDate: at(10) }], NOW),
    ).toEqual({ executable: 4, overdue: 2, oldestReadySince: at(-20) })
  })
})
