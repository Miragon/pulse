import { readFileSync } from "node:fs"
import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from "testcontainers"

type Environment = Readonly<Record<string, string>>

interface ClusterSettings {
  readonly images: {
    readonly camunda: readonly string[]
    readonly keycloak: string
    readonly elasticsearch: string
  }
  readonly camunda: Environment
  readonly keycloak: Environment
  readonly elasticsearch: Environment
  readonly storage: Readonly<Record<string, Environment>>
  readonly security: Readonly<Record<string, Environment>>
}

const SETTINGS = JSON.parse(
  readFileSync(new URL("cluster-settings.json", import.meta.url), "utf8"),
) as ClusterSettings

function choiceOf(variable: string, fallback: string, allowed: Readonly<Record<string, unknown>>) {
  const value = process.env[variable] ?? fallback
  if (!Object.hasOwn(allowed, value)) {
    throw new Error(`${variable} must be one of ${Object.keys(allowed).join(", ")}, not ${value}`)
  }
  return value
}

export const CAMUNDA_IMAGE = process.env.PULSE_ENGINE_IMAGE ?? ""
export const RUNS_ON_CAMUNDA_8 = /^camunda\/camunda[:@]/.test(CAMUNDA_IMAGE)
export const SECURITY = choiceOf("PULSE_C8_SECURITY", "none", SETTINGS.security)
export const STORAGE = choiceOf("PULSE_C8_STORAGE", "h2", SETTINGS.storage)

const REST_PORT = 8080
const MONITORING_PORT = 9600
const KEYCLOAK_PORT = 8080
const ELASTICSEARCH_PORT = 9200
const STARTUP_TIMEOUT_MS = 240_000
const AUDIENCE = "camunda"
const REALM = "pulse"
const REALM_FILE = new URL("keycloak-realm.json", import.meta.url)
const CREDENTIALS_READY_MS = 60_000

export interface RunningCluster {
  readonly url: string
  readonly seed: EngineCredentials
  readonly reader: EngineCredentials
  readonly nobody: EngineCredentials
  readonly shortLived?: EngineCredentials
  stop(): Promise<void>
}

type Logins = Omit<RunningCluster, "url" | "stop">

function startKeycloak(network: StartedNetwork): Promise<StartedTestContainer> {
  return new GenericContainer(SETTINGS.images.keycloak)
    .withNetwork(network)
    .withNetworkAliases("keycloak")
    .withExposedPorts(KEYCLOAK_PORT)
    .withEnvironment(SETTINGS.keycloak)
    .withCopyContentToContainer([
      {
        content: readFileSync(REALM_FILE, "utf8"),
        target: `/opt/keycloak/data/import/${REALM}.json`,
      },
    ])
    .withCommand(["start-dev", "--import-realm"])
    .withWaitStrategy(
      Wait.forHttp(`/realms/${REALM}/.well-known/openid-configuration`, KEYCLOAK_PORT),
    )
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start()
}

function startElasticsearch(network: StartedNetwork): Promise<StartedTestContainer> {
  return new GenericContainer(SETTINGS.images.elasticsearch)
    .withNetwork(network)
    .withNetworkAliases("elasticsearch")
    .withExposedPorts(ELASTICSEARCH_PORT)
    .withEnvironment(SETTINGS.elasticsearch)
    .withWaitStrategy(Wait.forHttp("/", ELASTICSEARCH_PORT))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start()
}

function startCamunda(network: StartedNetwork): Promise<StartedTestContainer> {
  return new GenericContainer(CAMUNDA_IMAGE)
    .withNetwork(network)
    .withExposedPorts(REST_PORT, MONITORING_PORT)
    .withEnvironment({
      ...SETTINGS.camunda,
      ...SETTINGS.storage[STORAGE],
      ...SETTINGS.security[SECURITY],
    })
    .withWaitStrategy(Wait.forHttp("/actuator/health/status", MONITORING_PORT))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start()
}

function clientOf(tokenEndpoint: string, client: string): EngineCredentials {
  return {
    kind: "clientCredentials",
    tokenEndpoint,
    clientId: `pulse-${client}`,
    clientSecret: `${client}-secret`,
    audience: AUDIENCE,
  }
}

function basicOf(username: string): EngineCredentials {
  return { kind: "basic", username, password: `${username}-password` }
}

export function credentialsWith(credentials: EngineCredentials, secret: string): EngineCredentials {
  if (credentials.kind === "basic") {
    return { ...credentials, password: secret }
  }
  return credentials.kind === "clientCredentials"
    ? { ...credentials, clientSecret: secret }
    : credentials
}

async function bearerOf(
  credentials: Extract<EngineCredentials, { readonly kind: "clientCredentials" }>,
): Promise<string> {
  const answer = await fetch(credentials.tokenEndpoint, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
  })
  const { access_token: token } = (await answer.json()) as { readonly access_token: string }
  return `Bearer ${token}`
}

export async function authorizationOf(
  credentials: EngineCredentials,
): Promise<Readonly<Record<string, string>>> {
  if (credentials.kind === "none") {
    return {}
  }
  if (credentials.kind === "basic") {
    const pair = `${credentials.username}:${credentials.password}`
    return { Authorization: `Basic ${Buffer.from(pair).toString("base64")}` }
  }
  return { Authorization: await bearerOf(credentials) }
}

async function untilCredentialsWork(url: string, credentials: EngineCredentials): Promise<void> {
  const deadline = Date.now() + CREDENTIALS_READY_MS
  for (;;) {
    const answer = await fetch(`${url}/topology`, { headers: await authorizationOf(credentials) })
    const leader = answer.ok && (await answer.text()).includes('"leader"')
    if (leader) {
      return
    }
    if (Date.now() > deadline) {
      throw new Error(`${url} does not accept the seeding credentials: HTTP ${answer.status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

async function stopAll(
  containers: readonly StartedTestContainer[],
  network: StartedNetwork,
): Promise<void> {
  const stopped = await Promise.allSettled(containers.map((container) => container.stop()))
  await network.stop()
  const failure = stopped.find((outcome) => outcome.status === "rejected")
  if (failure !== undefined) {
    throw failure.reason
  }
}

function tokenEndpointOf(keycloak: StartedTestContainer): string {
  const origin = `http://${keycloak.getHost()}:${keycloak.getMappedPort(KEYCLOAK_PORT)}`
  return `${origin}/realms/${REALM}/protocol/openid-connect/token`
}

function loginsOf(keycloak: StartedTestContainer | undefined): Logins {
  if (keycloak !== undefined) {
    const tokenEndpoint = tokenEndpointOf(keycloak)
    return {
      seed: clientOf(tokenEndpoint, "seed"),
      reader: clientOf(tokenEndpoint, "reader"),
      nobody: clientOf(tokenEndpoint, "nobody"),
      shortLived: clientOf(tokenEndpoint, "short"),
    }
  }
  if (SECURITY === "basic") {
    return { seed: basicOf("seed"), reader: basicOf("reader"), nobody: basicOf("nobody") }
  }
  const none: EngineCredentials = { kind: "none" }
  return { seed: none, reader: none, nobody: none }
}

async function startSideContainers(
  network: StartedNetwork,
  started: StartedTestContainer[],
): Promise<StartedTestContainer | undefined> {
  const tracked = async (start: Promise<StartedTestContainer>) => {
    const container = await start
    started.push(container)
    return container
  }
  const keycloakStart = SECURITY === "oidc" ? tracked(startKeycloak(network)) : undefined
  const elasticsearchStart =
    STORAGE === "elasticsearch" ? tracked(startElasticsearch(network)) : undefined
  await Promise.allSettled([keycloakStart, elasticsearchStart])
  await elasticsearchStart
  return keycloakStart
}

export async function startCluster(): Promise<RunningCluster> {
  const network = await new Network().start()
  const started: StartedTestContainer[] = []
  try {
    const keycloak = await startSideContainers(network, started)
    const camunda = await startCamunda(network)
    started.push(camunda)
    const url = `http://${camunda.getHost()}:${camunda.getMappedPort(REST_PORT)}/v2`
    const cluster: RunningCluster = {
      url,
      ...loginsOf(keycloak),
      stop: () => stopAll(started, network),
    }
    await untilCredentialsWork(cluster.url, cluster.seed)
    return cluster
  } catch (error: unknown) {
    await stopAll(started, network).catch(() => undefined)
    throw error
  }
}
