import { ConformanceKit, type ConformanceHarness } from "../../../src/contract/conformance/index.js"
import { afterAll, beforeAll, describe, test } from "vitest"
import { C7Adapter } from "../../../src/adapters/c7/index.js"
import { ENGINE_IMAGE, startEngine, type RunningEngine } from "./support/engine-container.js"
import { seedCommandWorld, seedWorld } from "./support/seed-world.js"

const UNREACHABLE_URL = "http://127.0.0.1:9/engine-rest"
const BATCHES_RUN_WITHIN = {
  withinMs: 90_000,
  wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}

function connectionTo(endpoint: string) {
  return { endpoint, credentials: { kind: "none" } } as const
}

describe(`the C7 adapter against ${ENGINE_IMAGE}`, () => {
  const adapter = new C7Adapter()
  let engine: RunningEngine | undefined
  let harness: ConformanceHarness | undefined

  beforeAll(async () => {
    engine = await startEngine()
    harness = {
      runtime: adapter.runtime(connectionTo(engine.url)),
      unreachableRuntime: adapter.runtime(connectionTo(UNREACHABLE_URL)),
      world: await seedWorld(engine.url),
    }
  })

  afterAll(async () => {
    await engine?.stop()
  })

  const kit = new ConformanceKit(test)

  kit.registerRuntimeLaws(() => {
    if (harness === undefined) {
      return Promise.reject(new Error("the engine did not start"))
    }
    return Promise.resolve(harness)
  })

  kit.registerCommandLaws(async () => {
    if (engine === undefined || harness === undefined) {
      throw new Error("the engine did not start")
    }
    return {
      runtime: harness.runtime,
      commands: adapter.commands(connectionTo(engine.url)),
      world: await seedCommandWorld(engine.url, harness.world),
      asyncWork: BATCHES_RUN_WITHIN,
    }
  })
})
