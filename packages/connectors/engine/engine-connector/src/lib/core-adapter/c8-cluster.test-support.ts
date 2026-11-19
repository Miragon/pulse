/**
 * A local Camunda 8 cluster for the connector's Camunda 8 engine suite (c8-runtime.engine.test.ts):
 * `camunda/camunda` (the image `PULSE_ENGINE_IMAGE` names) on H2 or Elasticsearch 9.5.5
 * (`PULSE_C8_STORAGE`, `h2` by default), without security, with Basic or with OIDC on Keycloak
 * 26.8.2 (`PULSE_C8_SECURITY`, `none` by default), in Testcontainers, over the stack of
 * c8-stack.test-support.ts. A trimmed copy of the C8 adapter's container start
 * (packages/connectors/c8/c8-adapter/test/support/engine-container.ts), since no package shares a
 * Node test helper with another: one login that seeds the world and one that reads it. Thomas
 * Heinrichs wrote the original for the C8 adapter in #543.
 */

import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from "testcontainers"
import type { C8SeedAnswer, C8SeedEngine, C8SeedRequest } from "@miragon/pulse-c8-core/testing"
import { C8_AUDIENCE, C8_REALM, C8_STACK } from "./c8-stack.test-support.js"

const REST_PORT = 8080
const MONITORING_PORT = 9600
const KEYCLOAK_PORT = 8080
const ELASTICSEARCH_PORT = 9200
const STARTUP_TIMEOUT_MS = 240_000
const CREDENTIALS_READY_MS = 60_000

function choiceOf(variable: string, allowed: Readonly<Record<string, unknown>>): string {
  const value = process.env[variable] ?? Object.keys(allowed)[0] ?? ""
  if (!Object.hasOwn(allowed, value)) {
    throw new Error(`${variable} must be one of ${Object.keys(allowed).join(", ")}, not ${value}`)
  }
  return value
}

/** The secondary storage (`PULSE_C8_STORAGE`) and the security (`PULSE_C8_SECURITY`) of the leg. */
export const C8_STORAGE = choiceOf("PULSE_C8_STORAGE", C8_STACK.storage)
export const C8_SECURITY = choiceOf("PULSE_C8_SECURITY", C8_STACK.security)

/** How a login signs in: not at all, Basic, or a client of the realm. */
export type C8Login =
  | { readonly type: "none" }
  | { readonly type: "basic"; readonly username: string; readonly password: string }
  | {
      readonly type: "clientCredentials"
      readonly tokenEndpoint: string
      readonly clientId: string
      readonly clientSecret: string
      readonly audience: string
    }

/** A started cluster: its REST root (`…/v2`), the login that seeds and the one that reads. */
export interface RunningC8Cluster {
  readonly url: string
  readonly seed: C8Login
  readonly reader: C8Login
  stop(): Promise<void>
}

function startKeycloak(network: StartedNetwork): Promise<StartedTestContainer> {
  return new GenericContainer(C8_STACK.images.keycloak)
    .withNetwork(network)
    .withNetworkAliases("keycloak")
    .withExposedPorts(KEYCLOAK_PORT)
    .withEnvironment(C8_STACK.keycloak)
    .withCopyContentToContainer([
      {
        content: JSON.stringify(C8_STACK.realm),
        target: `/opt/keycloak/data/import/${C8_REALM}.json`,
      },
    ])
    .withCommand(["start-dev", "--import-realm"])
    .withWaitStrategy(
      Wait.forHttp(`/realms/${C8_REALM}/.well-known/openid-configuration`, KEYCLOAK_PORT),
    )
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start()
}

function startElasticsearch(network: StartedNetwork): Promise<StartedTestContainer> {
  return new GenericContainer(C8_STACK.images.elasticsearch)
    .withNetwork(network)
    .withNetworkAliases("elasticsearch")
    .withExposedPorts(ELASTICSEARCH_PORT)
    .withEnvironment(C8_STACK.elasticsearch)
    .withWaitStrategy(Wait.forHttp("/", ELASTICSEARCH_PORT))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start()
}

function startCamunda(image: string, network: StartedNetwork): Promise<StartedTestContainer> {
  return new GenericContainer(image)
    .withNetwork(network)
    .withExposedPorts(REST_PORT, MONITORING_PORT)
    .withEnvironment({
      ...C8_STACK.camunda,
      ...C8_STACK.storage[C8_STORAGE],
      ...C8_STACK.security[C8_SECURITY],
    })
    .withWaitStrategy(Wait.forHttp("/actuator/health/status", MONITORING_PORT))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start()
}

/** The Authorization header of `login`, a token of the client credentials grant asked for anew. */
async function authorizationOf(login: C8Login): Promise<Readonly<Record<string, string>>> {
  if (login.type === "none") return {}
  if (login.type === "basic") {
    const pair = `${login.username}:${login.password}`
    return { Authorization: `Basic ${Buffer.from(pair).toString("base64")}` }
  }
  const answer = await fetch(login.tokenEndpoint, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: login.clientId,
      client_secret: login.clientSecret,
    }),
  })
  const { access_token: token } = (await answer.json()) as { readonly access_token: string }
  return { Authorization: `Bearer ${token}` }
}

/** The cluster c8-core's seed talks to: its REST root, `fetch` signed in as `login`, the clock. */
export function seedEngineOf(url: string, login: C8Login): C8SeedEngine {
  return {
    url,
    send: async (target: string, request: C8SeedRequest): Promise<C8SeedAnswer> =>
      fetch(target, {
        ...request,
        headers: { ...request.headers, ...(await authorizationOf(login)) },
      }),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  }
}

async function untilCredentialsWork(url: string, login: C8Login): Promise<void> {
  const deadline = Date.now() + CREDENTIALS_READY_MS
  for (;;) {
    const answer = await fetch(`${url}/topology`, { headers: await authorizationOf(login) })
    if (answer.ok && (await answer.text()).includes('"leader"')) return
    if (Date.now() > deadline) {
      throw new Error(`${url} does not accept the seeding login: HTTP ${answer.status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

async function stopAll(containers: StartedTestContainer[], network: StartedNetwork) {
  const stopped = await Promise.allSettled(containers.map((container) => container.stop()))
  await network.stop()
  const failure = stopped.find((outcome) => outcome.status === "rejected")
  if (failure !== undefined) throw failure.reason
}

function loginsOf(keycloak: StartedTestContainer | undefined) {
  if (keycloak !== undefined) {
    const origin = `http://${keycloak.getHost()}:${keycloak.getMappedPort(KEYCLOAK_PORT)}`
    const tokenEndpoint = `${origin}/realms/${C8_REALM}/protocol/openid-connect/token`
    const client = (name: string): C8Login => ({
      type: "clientCredentials",
      tokenEndpoint,
      clientId: `pulse-${name}`,
      clientSecret: `${name}-secret`,
      audience: C8_AUDIENCE,
    })
    return { seed: client("seed"), reader: client("reader") }
  }
  if (C8_SECURITY === "basic") {
    const user = (name: string): C8Login => ({
      type: "basic",
      username: name,
      password: `${name}-password`,
    })
    return { seed: user("seed"), reader: user("reader") }
  }
  const none: C8Login = { type: "none" }
  return { seed: none, reader: none }
}

/** Keycloak for OIDC, Elasticsearch as secondary storage: each only where the leg needs it. */
async function startSideContainers(network: StartedNetwork, started: StartedTestContainer[]) {
  const tracked = async (start: Promise<StartedTestContainer>) => {
    const container = await start
    started.push(container)
    return container
  }
  const keycloak = C8_SECURITY === "oidc" ? tracked(startKeycloak(network)) : undefined
  const elasticsearch =
    C8_STORAGE === "elasticsearch" ? tracked(startElasticsearch(network)) : undefined
  await Promise.allSettled([keycloak, elasticsearch])
  await elasticsearch
  return keycloak
}

/** Starts the leg's cluster on `image` and waits until it accepts the seeding login. */
export async function startC8Cluster(image: string): Promise<RunningC8Cluster> {
  const network = await new Network().start()
  const started: StartedTestContainer[] = []
  try {
    const keycloak = await startSideContainers(network, started)
    const camunda = await startCamunda(image, network)
    started.push(camunda)
    const url = `http://${camunda.getHost()}:${camunda.getMappedPort(REST_PORT)}/v2`
    const cluster = { url, ...loginsOf(keycloak), stop: () => stopAll(started, network) }
    await untilCredentialsWork(url, cluster.seed)
    return cluster
  } catch (error: unknown) {
    await stopAll(started, network).catch(() => undefined)
    throw error
  }
}
