/**
 * Engine containers for the integration tests: one definition per supported Camunda 7 compatible
 * distribution, started with Testcontainers and reachable through a mapped port.
 */

import { GenericContainer, type StartedNetwork, Wait } from "testcontainers"
import type { Flavor } from "../../../src/config/types.js"

export const ENGINE_NAMES = ["operaton", "cibseven"] as const
export type EngineName = (typeof ENGINE_NAMES)[number]

export interface EngineDefinition {
  readonly name: EngineName
  /** The engine adapter of pulse (`--flavor`, PULSE_CLI_FLAVOR). */
  readonly flavor: Flavor
  readonly image: string
  /** Container port of the HTTP server. */
  readonly port: number
  /** Path of the REST API root on that port. */
  readonly restPath: string
  /** Version reported by `GET /version`. */
  readonly version: string
  /**
   * Environment that protects the REST API with HTTP Basic authentication (Spring relaxed binding
   * of `<prefix>.bpm.run.auth.*`). The users are the engine's identity service, e.g. {@link ADMIN}.
   */
  readonly basicAuthEnv: Readonly<Record<string, string>>
  /**
   * Environment that keeps the Run distribution's invoice example from starting. The example
   * sets the engine's clock back while it seeds itself, after the REST API already answers, so
   * data a suite creates in that window gets timestamps from the rewound clock.
   */
  readonly withoutExampleEnv: Readonly<Record<string, string>>
}

export interface RunningEngine {
  readonly name: EngineName
  readonly flavor: Flavor
  /** REST API root, e.g. `http://localhost:32768/engine-rest`. */
  readonly url: string
  stop(): Promise<void>
}

/** Selects the engines to test; comma separated subset of {@link ENGINE_NAMES}. */
const ENGINES_ENV = "PULSE_CLI_IT_ENGINES"

const STARTUP_TIMEOUT_MS = 180_000
/** Timeout of a `beforeAll` that starts an engine: the startup plus pulling the image. */
export const ENGINE_START_TIMEOUT_MS = 240_000

/** The administrator that every Run distribution creates (`admin-user` of its default.yml). */
export const ADMIN = { username: "demo", password: "demo" } as const

export const ENGINES: Readonly<Record<EngineName, EngineDefinition>> = {
  operaton: {
    name: "operaton",
    flavor: "operaton",
    image: "operaton/operaton:2.1.5",
    port: 8080,
    restPath: "/engine-rest",
    version: "2.1.5",
    basicAuthEnv: { OPERATON_BPM_RUN_AUTH_ENABLED: "true" },
    withoutExampleEnv: { OPERATON_BPM_RUN_EXAMPLE_ENABLED: "false" },
  },
  cibseven: {
    name: "cibseven",
    flavor: "cibseven",
    image: "cibseven/cibseven:run-2.2.0",
    port: 8080,
    restPath: "/engine-rest",
    version: "2.2.0",
    // default.yml already enables auth, but with `pseudo` authentication that lets every request in
    basicAuthEnv: {
      CAMUNDA_BPM_RUN_AUTH_ENABLED: "true",
      CAMUNDA_BPM_RUN_AUTH_AUTHENTICATION: "basic",
    },
    withoutExampleEnv: { CAMUNDA_BPM_RUN_EXAMPLE_ENABLED: "false" },
  },
}

/** The process the Run distributions' example application deploys. */
const EXAMPLE_PROCESS_KEY = "invoice"

function isEngineName(value: string): value is EngineName {
  return ENGINE_NAMES.some((name) => name === value)
}

/** Engines selected by `PULSE_CLI_IT_ENGINES` (all when unset or empty). Unknown names fail loudly. */
function enabledEngines(env: NodeJS.ProcessEnv = process.env): EngineName[] {
  const raw = env[ENGINES_ENV]?.trim() ?? ""
  if (raw === "") return [...ENGINE_NAMES]
  const names = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "")
  const unknown = names.filter((entry) => !isEngineName(entry))
  if (unknown.length > 0) {
    throw new Error(
      `${ENGINES_ENV} contains unknown engine(s) ${unknown.join(", ")}; ` +
        `expected a comma separated subset of ${ENGINE_NAMES.join(", ")}`,
    )
  }
  return names.filter(isEngineName)
}

export function isEngineEnabled(name: EngineName, env: NodeJS.ProcessEnv = process.env): boolean {
  return enabledEngines(env).includes(name)
}

export interface StartOptions {
  /** Protect the REST API with HTTP Basic authentication ({@link EngineDefinition.basicAuthEnv}). */
  readonly basicAuth?: boolean
  /** A Docker network to join (the OAuth topology puts a gateway in front of the engine). */
  readonly network?: StartedNetwork
  /** Host name of the engine inside {@link network}. */
  readonly alias?: string
}

/** Fails when the example application deployed its process: it must not run (withoutExampleEnv). */
async function ensureWithoutExample(url: string, basicAuth: boolean, image: string): Promise<void> {
  const credentials = btoa(`${ADMIN.username}:${ADMIN.password}`)
  const headers: Record<string, string> = basicAuth ? { authorization: `Basic ${credentials}` } : {}
  const response = await fetch(`${url}/process-definition/count?key=${EXAMPLE_PROCESS_KEY}`, {
    headers,
  })
  if (!response.ok) {
    throw new Error(`GET ${url}/process-definition/count: HTTP ${response.status}`)
  }
  if (((await response.json()) as { readonly count: number }).count > 0) {
    throw new Error(
      `${image} runs its example application, which sets the engine clock back while a suite seeds; disable it in withoutExampleEnv`,
    )
  }
}

/**
 * Starts the engine container without its example application and waits until
 * `GET <rest-root>/version` answers 200 (with the {@link ADMIN} credentials when the REST API
 * requires authentication). An engine that still deployed the example is refused.
 */
export async function startEngine(
  name: EngineName,
  options: StartOptions = {},
): Promise<RunningEngine> {
  const definition = ENGINES[name]
  const basicAuth = options.basicAuth === true
  const ready = Wait.forHttp(`${definition.restPath}/version`, definition.port).forStatusCode(200)
  const image = new GenericContainer(definition.image)
    .withExposedPorts(definition.port)
    .withEnvironment({
      ...definition.withoutExampleEnv,
      ...(basicAuth ? definition.basicAuthEnv : {}),
    })
    .withWaitStrategy(
      basicAuth ? ready.withBasicCredentials(ADMIN.username, ADMIN.password) : ready,
    )
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
  if (options.network !== undefined) image.withNetwork(options.network)
  if (options.alias !== undefined) image.withNetworkAliases(options.alias)
  const container = await image.start()
  const url = `http://${container.getHost()}:${container.getMappedPort(definition.port)}${definition.restPath}`
  try {
    await ensureWithoutExample(url, basicAuth, definition.image)
  } catch (error) {
    await container.stop()
    throw error
  }
  return {
    name,
    flavor: definition.flavor,
    url,
    stop: async () => {
      await container.stop()
    },
  }
}
