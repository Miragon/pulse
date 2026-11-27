/** Edge cases, ordering and grouping of the status reads (status.ts). */

import { describe, expect, it } from "vitest"
import { definitionStatisticsOf, messageSignature } from "@miragon/pulse-c7-core"
import {
  definitionStatus,
  jobStatus,
  NOW,
  statistics,
  topicStatus,
} from "@miragon/pulse-c7-core/testing"
import { groupIncidents } from "../../test/support/workflow-status.js"

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

  it("keeps the keys with any instance, failed job or incident, unless named", () => {
    const rows = definitionStatisticsOf([
      statistics("inc", 1, [0, 0, 2]),
      statistics("fail", 1, [0, 3, 0]),
      statistics("run", 1, [1, 0, 0]),
      statistics("zero", 1, [0, 0, 0]),
    ])
    expect(definitionStatus(rows, []).map((status) => [status.key, status.incidents])).toEqual([
      ["inc", 2],
      ["fail", 0],
      ["run", 0],
    ])
  })

  it("sorts by incidents, failed jobs, instances, then key", () => {
    const rows = definitionStatisticsOf([
      statistics("e", 1, [1, 1, 0]),
      statistics("a", 1, [1, 0, 1]),
      statistics("d", 1, [5, 0, 0]),
      statistics("b", 1, [1, 2, 1]),
      statistics("c", 1, [5, 0, 0]),
      statistics("f", 1, [3, 1, 0]),
    ])
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
    const rows = definitionStatisticsOf([
      statistics("order", 1, [1, 0, 0]),
      statistics("order", 3, [1, 0, 0]),
      statistics("order", 2, [1, 0, 0]),
    ])
    expect(definitionStatus(rows, [])).toMatchObject([
      { key: "order", name: "order v3", latestVersion: 3, versions: 3, instances: 3 },
    ])
  })

  it("finds the key of an incident by its version in the statistics, else by the key its id names", () => {
    const bare = "6f1c2a9e-0b7d-4c33-9a51-3d2e8f40b7aa"
    const rows = [
      { id: bare, instances: 1, definition: { id: bare, key: "longProcessKey", version: 1 } },
      statistics("nested", 1, [1, 0, 0]),
    ]
    const keys = groupIncidents(
      [
        incident("a", { processDefinitionId: bare }),
        incident("c", { processDefinitionId: "nested:1:x" }),
        incident("d", { processDefinitionId: "unknown:1:x" }),
        incident("e", { processDefinitionId: undefined }),
      ],
      rows,
    ).groups.map((group) => group.processDefinitionKey)
    expect(keys.toSorted()).toEqual(["", "longProcessKey", "nested", "unknown"])
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

  it("masks a whole number as one mark", () => {
    expect(messageSignature("retried 12 times, 345 left")).toBe("retried <n> times, <n> left")
  })
})
