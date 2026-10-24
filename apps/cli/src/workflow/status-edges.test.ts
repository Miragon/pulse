/** Edge cases, ordering and grouping of the status reads (status.ts). */

import { describe, expect, it } from "vitest"
import { NOW, statistics } from "../../test/support/workflow-status.js"
import {
  definitionStatus,
  groupIncidents,
  jobStatus,
  messagePattern,
  topicStatus,
} from "./status.js"

describe("status edge cases", () => {
  const incident = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    rootCauseIncidentId: id,
    incidentType: "failedJob",
    activityId: "book",
    processDefinitionId: "order:1:x",
    incidentMessage: "boom",
    incidentTimestamp: "2026-01-01T10:00:00.000+0000",
    ...overrides,
  })

  it("sums incident counts of object entries only and keeps keys with any activity", () => {
    const rows = [
      { id: "inc:1:x", instances: 0, failedJobs: 0, incidents: [{ incidentCount: 2 }, null, 5] },
      { id: "fail:1:x", instances: 0, failedJobs: 3, incidents: "none" },
      { id: "run:1:x", instances: 1, failedJobs: 0 },
      { id: "zero:1:x", instances: 0, failedJobs: 0, incidents: [{ incidentCount: 0 }, {}] },
    ]
    expect(definitionStatus(rows, []).map((status) => [status.key, status.incidents])).toEqual([
      ["inc", 2],
      ["fail", 0],
      ["run", 0],
    ])
  })

  it("sorts by incidents, failed jobs, instances, then key", () => {
    const rows = [
      statistics("e", 1, [1, 1, 0]),
      statistics("a", 1, [1, 0, 1]),
      statistics("d", 1, [5, 0, 0]),
      statistics("b", 1, [1, 2, 1]),
      statistics("c", 1, [5, 0, 0]),
      statistics("f", 1, [3, 1, 0]),
    ]
    expect(definitionStatus(rows, []).map((status) => status.key)).toEqual([
      "b",
      "a",
      "f",
      "e",
      "c",
      "d",
    ])
  })

  it("takes the name and version of the highest version, in any order", () => {
    const rows = [
      statistics("order", 1, [1, 0, 0]),
      statistics("order", 3, [1, 0, 0]),
      statistics("order", 2, [1, 0, 0]),
    ]
    expect(definitionStatus(rows, [])).toMatchObject([
      { key: "order", name: "order v3", latestVersion: 3, versions: 3, instances: 3 },
    ])
  })

  it("finds the key of an incident in the statistics rows, with or without definition object", () => {
    const rows = [
      { id: "p:1:x", key: "flat" },
      { id: "q:1:x", definition: null, key: "nulled" },
      { id: "r:1:x", definition: { key: "nested" } },
      { instances: 1 },
    ]
    const keys = groupIncidents(
      [
        incident("a", { processDefinitionId: "p:1:x" }),
        incident("b", { processDefinitionId: "q:1:x" }),
        incident("c", { processDefinitionId: "r:1:x" }),
        incident("d", { processDefinitionId: "unknown:1:x" }),
        incident("e", { processDefinitionId: undefined }),
      ],
      rows,
    ).groups.map((group) => group.processDefinitionKey)
    expect(keys.toSorted()).toEqual(["", "flat", "nested", "nulled", "unknown"])
  })

  it("keeps fields apart in the group key and orders equal groups by last time, then command", () => {
    const grouped = groupIncidents(
      [
        incident("a", { activityId: "x", incidentType: "yz" }),
        incident("b", { activityId: "xy", incidentType: "z" }),
        incident("c", { activityId: "late", incidentTimestamp: "2026-01-01T11:00:00.000+0000" }),
      ],
      [],
    )
    expect(grouped.groups.map((group) => [group.activityId, group.type, group.count])).toEqual([
      ["late", "failedJob", 1],
      ["x", "yz", 1],
      ["xy", "z", 1],
    ])
  })

  it("shows the newest member (ties by id) and lists instance ids once, skipping missing ones", () => {
    const grouped = groupIncidents(
      [
        incident("b", { incidentMessage: "Job 2 failed", processInstanceId: "p1" }),
        incident("a", { incidentMessage: "Job 1 failed", processInstanceId: "p1" }),
        incident("c", {
          incidentMessage: "Job 3 failed",
          incidentTimestamp: "2026-01-01T09:00:00.000+0000",
        }),
      ],
      [],
    )
    expect(grouped.groups).toHaveLength(1)
    expect(grouped.groups[0]).toMatchObject({
      message: "Job 1 failed",
      count: 3,
      firstAt: "2026-01-01T09:00:00.000+0000",
      lastAt: "2026-01-01T10:00:00.000+0000",
      processInstanceIds: ["p1"],
    })
    expect(grouped.groups[0]?.newest).toMatchObject({ id: "a", processDefinitionKey: "order" })
  })

  it("counts a lock that expires right now as expired and ignores locked tasks without worker", () => {
    const now = "2026-01-01T12:00:00.000+0000"
    expect(
      topicStatus(
        [
          { topicName: "pay", lockExpirationTime: now, workerId: "w0" },
          { topicName: "pay", lockExpirationTime: "2026-01-01T12:00:01.000+0000" },
          { retries: 0 },
        ],
        NOW,
      ),
    ).toEqual([
      { topic: "", waiting: 0, locked: 0, lockExpired: 0, failed: 1, workers: [] },
      {
        topic: "pay",
        waiting: 0,
        locked: 1,
        lockExpired: 1,
        failed: 0,
        workers: [],
        oldestLockExpiredAt: now,
      },
    ])
  })

  it("is not overdue at exactly the threshold or without times", () => {
    const threshold = Date.parse("2026-01-01T11:00:00.000Z")
    expect(
      jobStatus(2, [{ dueDate: "2026-01-01T11:00:00.000+0000" }, { id: "no-time" }], threshold),
    ).toEqual({ executable: 2, overdue: 0 })
  })
})

describe("status ordering and grouping details", () => {
  const incident = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    rootCauseIncidentId: id,
    incidentType: "failedJob",
    activityId: "book",
    processDefinitionId: "order:1:x",
    incidentMessage: "Job 1 failed",
    incidentTimestamp: "2026-01-01T10:00:00.000+0000",
    ...overrides,
  })

  it("shows the member with the smaller id among equally new ones, in any input order", () => {
    for (const order of [
      ["a", "b"],
      ["b", "a"],
    ]) {
      const grouped = groupIncidents(
        order.map((id) => incident(id, { incidentMessage: `Job ${id === "a" ? 1 : 2} failed` })),
        [],
      )
      expect(grouped.groups[0]?.message).toBe("Job 1 failed")
    }
  })

  it("separates groups that differ only in type or message pattern", () => {
    expect(
      groupIncidents([incident("a"), incident("b", { incidentType: "custom" })], []).groups,
    ).toHaveLength(2)
    expect(
      groupIncidents([incident("a"), incident("b", { incidentMessage: "Other" })], []).groups,
    ).toHaveLength(2)
    expect(
      groupIncidents([incident("a"), incident("b", { incidentMessage: "Job 22 failed" })], [])
        .groups,
    ).toHaveLength(1)
  })

  it("puts larger groups first even when a smaller one is newer", () => {
    const grouped = groupIncidents(
      [
        incident("a", { activityId: "big" }),
        incident("b", { activityId: "big" }),
        incident("c", { activityId: "new", incidentTimestamp: "2026-01-01T11:00:00.000+0000" }),
      ],
      [],
    )
    expect(grouped.groups.map((group) => group.activityId)).toEqual(["big", "new"])
  })

  it("masks a digit run as one mark", () => {
    expect(messagePattern("retried 12 times, 345 left")).toBe("retried # times, # left")
  })
})
