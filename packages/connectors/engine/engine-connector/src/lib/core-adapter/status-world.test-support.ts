/**
 * c7-core's status world (`seedC7StatusWorld`) on two engines of an image, one at history level
 * FULL and one at NONE, each in a container of its own. The recording script of c7-core's recorded
 * status engine (status-world.record.test.ts) reads the server's surfaces of them through a
 * recording proxy; the engine suite (status-world.engine.test.ts) holds a world seeded on CIB
 * seven or Operaton to the recorded figures.
 */

import { GenericContainer, Wait } from "testcontainers"
import {
  type C7SeedEngine,
  type C7StatusWorldIds,
  seedC7StatusWorld,
} from "@miragon/pulse-c7-core/testing"

const ENGINE_PORT = 8080
const REST_ROOT = "/engine-rest"
const STARTUP_TIMEOUT_MS = 180_000

/** The two history levels the world is seeded at, each an engine of its own, by its name. */
const STATUS_HISTORY_LEVELS = ["full", "none"] as const

/** An engine of the status world: its name (its history level), its REST root, its stop. */
export interface StatusEngine {
  readonly engine: (typeof STATUS_HISTORY_LEVELS)[number]
  readonly url: string
  stop(): Promise<void>
}

/**
 * The engine at `historyLevel` without its bundled invoice example, which sets the engine's clock
 * back while it seeds itself, after the REST API already answers.
 */
async function startOne(
  image: string,
  historyLevel: StatusEngine["engine"],
): Promise<StatusEngine> {
  const container = await new GenericContainer(image)
    .withEnvironment({
      CAMUNDA_BPM_RUN_EXAMPLE_ENABLED: "false",
      OPERATON_BPM_RUN_EXAMPLE_ENABLED: "false",
      CAMUNDA_BPM_HISTORY_LEVEL: historyLevel,
      OPERATON_BPM_HISTORY_LEVEL: historyLevel,
    })
    .withExposedPorts(ENGINE_PORT)
    .withWaitStrategy(Wait.forHttp(`${REST_ROOT}/version`, ENGINE_PORT).forStatusCode(200))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start()
  const url = `http://${container.getHost()}:${container.getMappedPort(ENGINE_PORT)}${REST_ROOT}`
  return { engine: historyLevel, url, stop: () => container.stop().then(() => undefined) }
}

/** Stops every engine, whichever stop fails. */
export async function stopAll(engines: readonly StatusEngine[]): Promise<void> {
  await Promise.allSettled(engines.map((engine) => engine.stop()))
}

/** Both engines of `image`, FULL then NONE, started at once; one that fails stops the other. */
export async function startStatusEngines(image: string): Promise<StatusEngine[]> {
  const started = await Promise.allSettled(
    STATUS_HISTORY_LEVELS.map((level) => startOne(image, level)),
  )
  const engines = started.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
  const failed = started.find((result) => result.status === "rejected")
  if (failed !== undefined) {
    await stopAll(engines)
    throw failed.reason
  }
  return engines
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Seeds the status world into each engine, all at once, over the global fetch; each one's ids. */
export function seedStatusEngines(engines: readonly StatusEngine[]): Promise<C7StatusWorldIds[]> {
  return Promise.all(
    engines.map(({ url }) => {
      const engine: C7SeedEngine = { url, send: (target, request) => fetch(target, request), wait }
      return seedC7StatusWorld(engine)
    }),
  )
}
