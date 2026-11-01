import { describe, expect, it, vi } from "vitest"
import { ACTIVITY_BREAKDOWN_LIMIT, dashboardData } from "./dashboard.js"
import type { PromSample } from "../prometheus.js"

/** The dashboard's activity rows: what each row carries, which activities get one, how many. */

const def = (key: string, value: number): PromSample => ({
  metric: { process_definition_key: key },
  value,
})
const act = (key: string, id: string, value: number, type?: string): PromSample => ({
  metric: {
    process_definition_key: key,
    activity_id: id,
    ...(type ? { activity_type: type } : {}),
  },
  value,
})

/** A client that answers each query with the samples `answer` picks for it. */
const clientOf = (answer: (q: string) => PromSample[]) => ({
  instant: vi.fn((q: string) => Promise.resolve(answer(q))),
})

describe("dashboardData: the activity rows", () => {
  it("attaches the median and the incidents created at each (process, activity) to its row", async () => {
    const bucket = "camunda_activity_duration_milliseconds_bucket"
    const ch = clientOf((q) => {
      if (q.includes("camunda_activity_ended_total")) {
        return [
          act("order", "Task_check", 10, "serviceTask"),
          act("invoice", "Task_check", 4, "serviceTask"),
          act("order", "Task_send", 2, "sendTask"),
        ]
      }
      if (
        q.startsWith("histogram_quantile(0.5, sum by (process_definition_key, activity_id, le)(") &&
        q.includes(bucket)
      ) {
        return [act("order", "Task_check", 1_200.4), act("invoice", "Task_check", 800)]
      }
      if (
        q.startsWith("sum by (process_definition_key, activity_id)(") &&
        q.includes("increase(camunda_incident_created_total")
      ) {
        // The same activity id in two processes keeps two counts.
        return [act("order", "Task_check", 3), act("invoice", "Task_check", 1)]
      }
      return []
    })
    const res = await dashboardData(ch, { period: "7d" })

    const rows = res.activityBreakdown.map((a) => [
      a.processDefinitionKey,
      a.activityId,
      a.medianDurationMs,
      a.incidentsCreated,
    ])
    expect(rows).toEqual(
      expect.arrayContaining([
        ["order", "Task_check", 1_200, 3],
        ["invoice", "Task_check", 800, 1],
        // No incidents at it: 0. No median sample: unmeasured, never 0 ms.
        ["order", "Task_send", null, 0],
      ]),
    )
    expect(rows).toHaveLength(3)
  })

  /** 23 activities of `order`, Task_i taking (i + 1) s in total. */
  function manyActivities() {
    const rows = Array.from({ length: 23 }, (_, i) => act("order", `Task_${i}`, 1, "serviceTask"))
    const sums = rows.map((r, i) => ({ ...r, value: (i + 1) * 1000 }))
    return vi.fn((q: string): Promise<PromSample[]> => {
      if (q.includes("camunda_activity_ended_total")) return Promise.resolve(rows)
      if (q.includes("camunda_activity_duration_milliseconds_sum")) return Promise.resolve(sums)
      return Promise.resolve([])
    })
  }

  it("keeps the top 20 activities by total time and says how many there were", async () => {
    const res = await dashboardData({ instant: manyActivities() }, { period: "7d" })

    expect(ACTIVITY_BREAKDOWN_LIMIT).toBe(20)
    expect(res.activityCount).toBe(23)
    expect(res.activityBreakdown).toHaveLength(20)
    expect(res.activityBreakdown[0]).toMatchObject({ activityId: "Task_22", totalTimeMs: 23_000 })
    expect(res.activityBreakdown[19]).toMatchObject({ activityId: "Task_3" })
  })

  it("lists every activity of one process, a fast one past the top 20 included", async () => {
    const res = await dashboardData(
      { instant: manyActivities() },
      { processDefinitionKey: "order", period: "7d" },
    )

    expect(res.activityCount).toBe(23)
    expect(res.activityBreakdown).toHaveLength(23)
    expect(res.activityBreakdown[22]).toMatchObject({ activityId: "Task_0", totalTimeMs: 1_000 })
  })

  it("gives an activity whose executions all failed a row from its incidents alone", async () => {
    const ch = clientOf((q) => {
      if (q.includes("camunda_activity_ended_total"))
        return [act("order", "Task_ok", 5, "userTask")]
      if (
        q.startsWith("sum by (process_definition_key, activity_id)(") &&
        q.includes("incident_created")
      ) {
        return [
          act("order", "Task_ok", 1),
          act("order", "Task_fail", 4),
          // A sample without an activity, and one that rounds to no incident: no row.
          def("order", 2),
          act("order", "Task_quiet", 0.4),
        ]
      }
      return []
    })
    const res = await dashboardData(ch, { processDefinitionKey: "order", period: "7d" })

    expect(res.activityCount).toBe(2)
    expect(res.activityBreakdown).toEqual([
      expect.objectContaining({ activityId: "Task_ok", executionCount: 5, incidentsCreated: 1 }),
      {
        processDefinitionKey: "order",
        activityId: "Task_fail",
        activityType: "",
        executionCount: 0,
        avgDurationMs: null,
        medianDurationMs: null,
        p95DurationMs: null,
        totalTimeMs: 0,
        incidentsCreated: 4,
      },
    ])
  })
})
