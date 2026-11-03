import { describe, expect, it } from "vitest"
import {
  defaultGroupOrder,
  definitionStatus,
  groupIncidents,
  jobStatus,
  messagePattern,
  topicStatus,
  unknownKeys,
} from "./status.js"
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
      [statistics("order", 1, [1, 1, 1])],
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
  it("masks message patterns, sums definitions and finds unknown keys", () => {
    expect(messagePattern("Job 6f2b8c3e-0f4a-11ef-a1b2-0242ac120002 failed 3 times")).toBe(
      "Job # failed # times",
    )
    const rows = [statistics("order", 1, [2, 0, 0]), statistics("order", 2, [1, 1, 1])]
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
