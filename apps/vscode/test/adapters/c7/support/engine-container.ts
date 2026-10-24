import { GenericContainer, Wait } from "testcontainers"

export const ENGINE_IMAGE = process.env.PULSE_ENGINE_IMAGE ?? "operaton/operaton:2.1.5"

const ENGINE_PORT = 8080
const REST_ROOT = "/engine-rest"
const STARTUP_TIMEOUT_MS = 180_000

export interface RunningEngine {
  readonly url: string
  stop(): Promise<void>
}

export async function startEngine(image: string = ENGINE_IMAGE): Promise<RunningEngine> {
  const container = await new GenericContainer(image)
    .withExposedPorts(ENGINE_PORT)
    .withWaitStrategy(Wait.forHttp(`${REST_ROOT}/version`, ENGINE_PORT).forStatusCode(200))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start()
  return {
    url: `http://${container.getHost()}:${container.getMappedPort(ENGINE_PORT)}${REST_ROOT}`,
    stop: async () => {
      await container.stop()
    },
  }
}
