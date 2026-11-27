import { afterEach, describe, expect, it, vi } from "vitest"
import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import { dropAfterWrite, engineClientKey } from "../lib/engine/per-engine.js"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeReply,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import { readElementCounts } from "./element-counts.js"
import { readStatistics } from "./statistics-floor.js"

/**
 * The element counts read only the versions a statistics read names held (F27), so each version's
 * counts are kept under the read that chose them: a renewed or dropped statistics read takes them
 * with it, and counts read under one never sum with counts read under another. Otherwise a version
 * read before a migration and one read after count an instance on both (#691, review R1).
 */

const engines: FakeEngine[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

const V1 = "claims:1:d1"
const V2 = "claims:2:d2"
const ELEMENT_STATISTICS = /^\/process-definition\/(.+)\/statistics$/

/**
 * An engine that runs 5 instances of `claims` at `task`: all on v1 until `migrate()` moves 2 of
 * them to v2.
 */
async function migratingEngine() {
  let migrated = false
  const running = (id: string | undefined) => {
    if (id === V1) return migrated ? 3 : 5
    return id === V2 && migrated ? 2 : 0
  }
  const row = (id: string, version: number) => ({
    id,
    instances: running(id),
    failedJobs: 0,
    incidents: [],
    definition: { id, key: "claims", version },
  })
  const engine = await startFakeEngine({}, (request: RecordedRequest): FakeReply => {
    if (request.path === "/process-definition/statistics") {
      return { body: [row(V1, 1), row(V2, 2)] }
    }
    const instances = running(ELEMENT_STATISTICS.exec(request.path)?.[1])
    return {
      body: instances === 0 ? [] : [{ id: "task", instances, failedJobs: 0, incidents: [] }],
    }
  })
  engines.push(engine)
  const client = clientFor(engine)
  const as = <T>(call: () => Promise<T>) =>
    runWithMcpRequestInfo({ authUserId: "ada", authorization: "Bearer ada" }, call)
  return {
    client,
    as,
    migrate: () => {
      migrated = true
    },
    running: async () => (await as(() => readElementCounts(client, [V2, V1]))).get("task")?.active,
  }
}

describe("element counts across a migration: an instance counts once", () => {
  it("reads every version anew after a write, under the statistics read the write renewed", async () => {
    const { client, as, migrate, running } = await migratingEngine()
    // A view read the statistics: v2 is idle, so only v1 is read.
    await as(() => readStatistics(client))
    expect(await running()).toBe(5)

    // engine_migrate_process_instances_async answered and its batch ran.
    migrate()
    dropAfterWrite(engineClientKey(client))
    await as(() => readStatistics(client))

    expect(await running()).toBe(5)
  })

  it("reads every version anew after a write on a cold statistics floor", async () => {
    const { client, migrate, running } = await migratingEngine()
    expect(await running()).toBe(5)

    migrate()
    dropAfterWrite(engineClientKey(client))

    expect(await running()).toBe(5)
  })

  it("reads every version anew once the statistics read that chose them expired", async () => {
    const { client, as, migrate, running } = await migratingEngine()
    const clock = vi.spyOn(Date, "now")
    const start = Date.UTC(2026, 10, 27, 12)
    clock.mockReturnValue(start)
    await as(() => readStatistics(client))
    clock.mockReturnValue(start + 15_000)
    expect(await running()).toBe(5)

    // A migration outside Pulse, then the statistics floor runs out and a view reads it anew.
    migrate()
    clock.mockReturnValue(start + 31_000)
    await as(() => readStatistics(client))

    expect(await running()).toBe(5)
  })
})
