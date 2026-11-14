import { ConformanceKit, type ConformanceHarness } from "@miragon/pulse-engine-core/testing"
import { afterAll, beforeAll, describe, test } from "vitest"
import { C7Adapter } from "../src/index.js"
import { ENGINE_IMAGE, startEngine, type RunningEngine } from "./support/engine-container.js"
import { seedWorld } from "./support/seed-world.js"

const UNREACHABLE_URL = "http://127.0.0.1:9/engine-rest"

function connectionTo(endpoint: string) {
  return { endpoint, credentials: { kind: "none" } } as const
}

async function countAt(url: string): Promise<number> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`GET ${url}: HTTP ${response.status}`)
  }
  return ((await response.json()) as { readonly count: number }).count
}

async function ensureNoIncidentHistory(engineUrl: string): Promise<void> {
  const [open, recorded] = await Promise.all([
    countAt(`${engineUrl}/incident/count`),
    countAt(`${engineUrl}/history/incident/count`),
  ])
  if (open === 0 || recorded > 0) {
    throw new Error(
      `the engine records its ${open} open incidents in its history (${recorded}): it does not run at history level AUDIT`,
    )
  }
}

describe(`the C7 adapter's reads against ${ENGINE_IMAGE} at history level AUDIT`, () => {
  const adapter = new C7Adapter()
  let engine: RunningEngine | undefined
  let harness: ConformanceHarness | undefined

  beforeAll(async () => {
    engine = await startEngine(ENGINE_IMAGE, "audit")
    const world = await seedWorld(engine.url)
    await ensureNoIncidentHistory(engine.url)
    harness = {
      runtime: adapter.runtime(connectionTo(engine.url)),
      unreachableRuntime: adapter.runtime(connectionTo(UNREACHABLE_URL)),
      world,
    }
  })

  afterAll(async () => {
    await engine?.stop()
  })

  new ConformanceKit(test).registerRuntimeLaws(() => {
    if (harness === undefined) {
      return Promise.reject(new Error("the engine did not start"))
    }
    return Promise.resolve(harness)
  })
})
