import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { containerTool, removeContainer, startContainer, waitUntil } from "./support/containers.mjs"

const SUPPORT = new URL("../test/adapters/c8/support/", import.meta.url)
const WORLD = new URL("../test/adapters/c8/world/", import.meta.url)
const SETTINGS = JSON.parse(readFileSync(new URL("cluster-settings.json", SUPPORT), "utf8"))
const IMAGE = process.env.PULSE_ENGINE_IMAGE ?? SETTINGS.images.camunda
const NETWORK = "pulse-c8"
const CAMUNDA = "pulse-c8-engine"
const KEYCLOAK = "pulse-c8-keycloak"
const ELASTICSEARCH = "pulse-c8-elasticsearch"
const REST_PORT = "18088"
const MONITORING_PORT = "18188"
const KEYCLOAK_PORT = "18089"
const REST_URL = `http://localhost:${REST_PORT}/v2`
const REALM_URL = `http://localhost:${KEYCLOAK_PORT}/realms/pulse`
const TOKEN_ENDPOINT = `${REALM_URL}/protocol/openid-connect/token`
const STARTUP_MS = 240_000
const SETTLED_MS = 120_000
const FAILING_JOB_TYPES = { "charge-payment": 4, "render-label": 2 }
const WORKER_ERROR = [
  "java.lang.IllegalStateException: the worker failed",
  "\tat io.miragon.shop.Worker.handle(Worker.java:42)",
  "Caused by: java.net.ConnectException: the card gateway is unreachable",
  "\tat io.miragon.shop.Gateway.connect(Gateway.java:7)",
].join("\n")
const ORDERS = [
  ["ORD-1001", "order@1", "review"],
  ["ORD-1002", "order@1", "charge"],
  ["ORD-1003", "order@1", "express"],
  ["ORD-2001", "order@2", "review"],
  ["ORD-2002", "order@2", "review"],
  ["ORD-2003", "order@2", "review"],
  ["ORD-2004", "order@2", "charge"],
  ["ORD-2005", "order@2", "charge"],
  ["ORD-2006", "order@2", "review"],
  ["ORD-2007", "order@2", "express"],
  ["ORD-2008", "order@2", "review"],
  ["ORD-2009", "order@2", "charge"],
  ["ORD-2010", "order@2", "review"],
]
const LOGINS = {
  none: "No credentials needed: pick the profile c8-open.",
  basic: "Pick the profile c8-basic. Set credentials: username reader, password reader-password.",
  oidc: "Pick the profile c8-oidc. Set credentials: client ID pulse-reader, client secret reader-secret. Operate's browser login does not work on this stack: Keycloak's public name is keycloak:8080.",
}

function container(...args) {
  execFileSync(containerTool(), args, { stdio: "ignore" })
}

function removeNetwork() {
  try {
    container("network", "rm", NETWORK)
  } catch {
    return
  }
}

function down() {
  for (const name of [CAMUNDA, KEYCLOAK, ELASTICSEARCH]) {
    removeContainer(name)
  }
  removeNetwork()
}

function inNetwork(alias) {
  return ["--network", NETWORK, "--network-alias", alias]
}

async function startKeycloak() {
  const realm = fileURLToPath(new URL("keycloak-realm.json", SUPPORT))
  startContainer({
    name: KEYCLOAK,
    image: SETTINGS.images.keycloak,
    port: KEYCLOAK_PORT,
    environment: SETTINGS.keycloak,
    options: [...inNetwork("keycloak"), "-v", `${realm}:/opt/keycloak/data/import/pulse.json:ro`],
    command: ["start-dev", "--import-realm"],
  })
  await waitUntil(
    async () => (await fetch(`${REALM_URL}/.well-known/openid-configuration`)).ok,
    "Keycloak to start",
    STARTUP_MS,
  )
}

async function startElasticsearch() {
  startContainer({
    name: ELASTICSEARCH,
    image: SETTINGS.images.elasticsearch,
    environment: SETTINGS.elasticsearch,
    options: inNetwork("elasticsearch"),
  })
  await waitUntil(
    async () => {
      container("exec", ELASTICSEARCH, "curl", "-sf", "http://localhost:9200")
      return true
    },
    "Elasticsearch to start",
    STARTUP_MS,
  )
}

async function startCamunda(storage, security) {
  startContainer({
    name: CAMUNDA,
    image: IMAGE,
    port: REST_PORT,
    environment: {
      ...SETTINGS.camunda,
      ...SETTINGS.storage[storage],
      ...SETTINGS.security[security],
    },
    options: [...inNetwork("camunda"), "-p", `${MONITORING_PORT}:9600`],
  })
  await waitUntil(
    async () => (await fetch(`http://localhost:${MONITORING_PORT}/actuator/health/status`)).ok,
    "Camunda 8 to start",
    STARTUP_MS,
  )
}

async function seedHeaders(security) {
  if (security === "basic") {
    const pair = Buffer.from("seed:seed-password").toString("base64")
    return { Authorization: `Basic ${pair}` }
  }
  if (security !== "oidc") {
    return {}
  }
  const answer = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: "pulse-seed",
      client_secret: "seed-secret",
    }),
  })
  const { access_token: token } = await answer.json()
  return { Authorization: `Bearer ${token}` }
}

function clusterCalls(headers) {
  const call = async (path, init) => {
    const response = await fetch(`${REST_URL}${path}`, {
      ...init,
      headers: { ...headers, ...init?.headers },
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`${path}: HTTP ${response.status} ${text}`)
    }
    return text === "" ? undefined : JSON.parse(text)
  }
  return {
    get: (path) => call(path),
    post: (path, body) =>
      call(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    deploy: (form) => call("/deployments", { method: "POST", body: form }),
  }
}

async function deploy(calls, process, marker = "") {
  const model = readFileSync(new URL(`${process}.bpmn`, WORLD), "utf8")
  const xml = marker === "" ? model : `${model}\n<!-- ${marker} -->\n`
  const form = new FormData()
  form.append("resources", new Blob([xml], { type: "application/xml" }), `${process}.bpmn`)
  const { deployments } = await calls.deploy(form)
  return deployments[0].processDefinition.processDefinitionKey
}

async function deployAll(calls) {
  await deploy(calls, "label")
  return {
    "order@1": await deploy(calls, "order"),
    "order@2": await deploy(calls, "order", "order@2"),
    dispatch: await deploy(calls, "dispatch"),
    waits: await deploy(calls, "waits"),
  }
}

async function startInstance(calls, processDefinitionKey, businessId, variables) {
  await calls.post("/process-instances", { processDefinitionKey, businessId, variables })
}

async function startAll(calls, definitions) {
  for (const [businessId, version, route] of ORDERS) {
    const variables = { route, amount: 42, customer: "C-77", orderId: businessId }
    await startInstance(calls, definitions[version], businessId, variables)
  }
  for (const businessId of ["DSP-3001", "DSP-3002"]) {
    await startInstance(calls, definitions.dispatch, businessId, { orderId: "ORD-1001" })
  }
  await startInstance(calls, definitions.waits, "WAIT-4001", { orderId: "ORD-1001" })
}

async function failJobs(calls, type, expected) {
  let failed = 0
  await waitUntil(
    async () => {
      const { jobs } = await calls.post("/jobs/activation", {
        type,
        worker: "pulse-seed",
        timeout: 60_000,
        maxJobsToActivate: expected,
      })
      for (const job of jobs) {
        await calls.post(`/jobs/${job.jobKey}/failure`, { retries: 0, errorMessage: WORKER_ERROR })
        failed += 1
      }
      return failed >= expected
    },
    `${expected} jobs of ${type}`,
    SETTLED_MS,
  )
}

async function seed(security) {
  const calls = clusterCalls(await seedHeaders(security))
  await waitUntil(
    async () => JSON.stringify(await calls.get("/topology")).includes('"leader"'),
    "the cluster to accept the seeding credentials",
    SETTLED_MS,
  )
  await startAll(calls, await deployAll(calls))
  for (const [type, expected] of Object.entries(FAILING_JOB_TYPES)) {
    await failJobs(calls, type, expected)
  }
  const incidents = Object.values(FAILING_JOB_TYPES).reduce((sum, count) => sum + count, 0)
  await waitUntil(
    async () => {
      const { items } = await calls.post("/incidents/search", { filter: { state: "ACTIVE" } })
      return items.length >= incidents
    },
    `${incidents} incidents in the secondary storage`,
    SETTLED_MS,
  )
}

async function up(storage, security) {
  down()
  container("network", "create", NETWORK)
  await Promise.all([
    security === "oidc" ? startKeycloak() : undefined,
    storage === "elasticsearch" ? startElasticsearch() : undefined,
  ])
  await startCamunda(storage, security)
  await seed(security)
  console.log(`Camunda 8 ready at ${REST_URL} (${IMAGE}, ${storage}, security ${security}).`)
  console.log(`Open apps/vscode/dev/host/workspace-c8 in the extension. ${LOGINS[security]}`)
}

function choice(value, allowed, flag) {
  if (!Object.hasOwn(allowed, value)) {
    throw new Error(`${flag} must be one of ${Object.keys(allowed).join(", ")}.`)
  }
  return value
}

const { positionals, values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  allowPositionals: true,
  options: {
    security: { type: "string", default: "none" },
    storage: { type: "string", default: "h2" },
  },
})

if (positionals[0] === "up") {
  await up(
    choice(values.storage, SETTINGS.storage, "--storage"),
    choice(values.security, SETTINGS.security, "--security"),
  )
} else if (positionals[0] === "down") {
  down()
} else {
  console.error(
    "Usage: node scripts/c8.mjs up [--security none|basic|oidc] [--storage h2|elasticsearch] | down",
  )
  process.exit(1)
}
