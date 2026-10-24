import { ConformanceKit, type ConformanceHarness } from "../../../src/contract/conformance/index.js"
import { afterAll, beforeAll, describe, test } from "vitest"
import { C7Adapter } from "../../../src/adapters/c7/index.js"
import { ENGINE_IMAGE, startEngine, type RunningEngine } from "./support/engine-container.js"
import {
  ENGINE_CLI_PATH,
  writeEngineCliConfig,
  type EngineCliConfig,
} from "./support/engine-cli-binary.js"
import { seedCommandWorld, seedWorld } from "./support/seed-world.js"

const UNREACHABLE_URL = "http://127.0.0.1:9/engine-rest"
const BATCHES_RUN_WITHIN = {
  withinMs: 90_000,
  wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}

function adapterWith(config: EngineCliConfig): C7Adapter {
  return C7Adapter.create({ cliPath: ENGINE_CLI_PATH, configPath: config.path })
}

function connectionTo(endpoint: string) {
  return { endpoint, credentials: { kind: "none" } } as const
}

describe(`the C7 adapter against ${ENGINE_IMAGE}`, () => {
  let engine: RunningEngine | undefined
  let config: EngineCliConfig | undefined
  let harness: ConformanceHarness | undefined

  beforeAll(async () => {
    config = await writeEngineCliConfig()
    engine = await startEngine()
    const adapter = adapterWith(config)
    harness = {
      runtime: adapter.runtime(connectionTo(engine.url)),
      unreachableRuntime: adapter.runtime(connectionTo(UNREACHABLE_URL)),
      world: await seedWorld(engine.url),
    }
  })

  afterAll(async () => {
    await engine?.stop()
    await config?.remove()
  })

  const kit = new ConformanceKit(test)

  kit.registerRuntimeLaws(() => {
    if (harness === undefined) {
      return Promise.reject(new Error("the engine did not start"))
    }
    return Promise.resolve(harness)
  })

  kit.registerCommandLaws(async () => {
    if (engine === undefined || config === undefined || harness === undefined) {
      throw new Error("the engine did not start")
    }
    return {
      runtime: harness.runtime,
      commands: adapterWith(config).commands(connectionTo(engine.url)),
      world: await seedCommandWorld(engine.url, harness.world),
      asyncWork: BATCHES_RUN_WITHIN,
    }
  })
})
