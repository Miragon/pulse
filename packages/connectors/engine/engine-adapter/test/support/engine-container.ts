import { GenericContainer, Wait } from "testcontainers"

export const ENGINE_IMAGE = process.env.PULSE_ENGINE_IMAGE ?? "operaton/operaton:2.1.5"

const ENGINE_PORT = 8080
const REST_ROOT = "/engine-rest"
const STARTUP_TIMEOUT_MS = 180_000
const EXAMPLE_PROCESS_KEY = "invoice"

const WITHOUT_RUN_EXAMPLE = {
  CAMUNDA_BPM_RUN_EXAMPLE_ENABLED: "false",
  OPERATON_BPM_RUN_EXAMPLE_ENABLED: "false",
} as const

export interface RunningEngine {
  readonly url: string
  stop(): Promise<void>
}

async function exampleDefinitions(url: string): Promise<number> {
  const response = await fetch(`${url}/process-definition/count?key=${EXAMPLE_PROCESS_KEY}`)
  if (!response.ok) {
    throw new Error(`GET ${url}/process-definition/count: HTTP ${response.status}`)
  }
  return ((await response.json()) as { readonly count: number }).count
}

async function ensureWithoutExample(url: string, image: string): Promise<void> {
  if ((await exampleDefinitions(url)) > 0) {
    throw new Error(
      `${image} runs its example application, which sets the engine clock back while the world is seeded; disable it in WITHOUT_RUN_EXAMPLE`,
    )
  }
}

export async function startEngine(image: string = ENGINE_IMAGE): Promise<RunningEngine> {
  const container = await new GenericContainer(image)
    .withEnvironment(WITHOUT_RUN_EXAMPLE)
    .withExposedPorts(ENGINE_PORT)
    .withWaitStrategy(Wait.forHttp(`${REST_ROOT}/version`, ENGINE_PORT).forStatusCode(200))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start()
  const url = `http://${container.getHost()}:${container.getMappedPort(ENGINE_PORT)}${REST_ROOT}`
  try {
    await ensureWithoutExample(url, image)
  } catch (error) {
    await container.stop()
    throw error
  }
  return {
    url,
    stop: async () => {
      await container.stop()
    },
  }
}
