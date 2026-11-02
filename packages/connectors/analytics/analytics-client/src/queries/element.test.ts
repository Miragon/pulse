import { describe, expect, it, vi } from "vitest"
import type { PrometheusClient, PromSample } from "../prometheus.js"
import { elementHeat } from "./element.js"

/** Counts for the ended-activity query, duration sums (ms) for the `_sum` query. */
function client(counts: PromSample[], sums: PromSample[]): PrometheusClient {
  return {
    instant: vi.fn((q: string) => Promise.resolve(q.includes("_sum") ? sums : counts)),
  }
}

const sample = (activity_id: string, value: number): PromSample => ({
  metric: { activity_id },
  value,
})

describe("elementHeat", () => {
  it("averages each activity's duration in whole milliseconds", async () => {
    const res = await elementHeat(
      client(
        [sample("Task_A", 3), sample("Task_B", 2.4), sample("Task_C", 0.2)],
        [sample("Task_A", 1000), sample("Task_B", 5), sample("Task_C", 900)],
      ),
      { processDefinitionKey: "invoice", period: "7d" },
    )
    // Task_A: 1000 / 3 = 333.3 → 333. Task_B: 2.4 ends round to 2, 5 / 2 = 2.5 → 3. Task_C: 0 ends.
    expect(res.frequency).toEqual({ Task_A: 3, Task_B: 2 })
    expect(res.durationMs).toEqual({ Task_A: 333, Task_B: 3 })
  })

  it("reads an activity without a duration sum as 0 ms", async () => {
    const res = await elementHeat(client([sample("Task_A", 4)], []), {
      processDefinitionKey: "invoice",
      period: "7d",
    })
    expect(res.durationMs).toEqual({ Task_A: 0 })
  })
})
