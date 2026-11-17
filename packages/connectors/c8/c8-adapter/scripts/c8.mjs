import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const SUPPORT = new URL("../test/support/", import.meta.url)
const WORLD = new URL("../../c8-core/world/", import.meta.url)
const SETTINGS = JSON.parse(readFileSync(new URL("cluster-settings.json", SUPPORT), "utf8"))
const IMAGE = process.env.PULSE_ENGINE_IMAGE ?? SETTINGS.images.camunda.at(-1)
const NETWORK = "pulse-c8"
const CAMUNDA = "pulse-c8-engine"
const KEYCLOAK = "pulse-c8-keycloak"
const ELASTICSEARCH = "pulse-c8-elasticsearch"
const REST_PORT = "18088"
const MONITORING_PORT = "18188"
const KEYCLOAK_PORT = "18089"
const ORIGIN = `http://localhost:${REST_PORT}`
const REST_URL = `${ORIGIN}/v2`
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
const ROUTES = {
  "order@1": { from: 1001, routes: "review charge express" },
  "order@2": {
    from: 2001,
    routes: "review review review charge charge review express review charge review",
  },
}
const READER = {
  none: { login: "No login needed." },
  basic: {
    auth: { type: "basic", username: "reader" },
    login: "Set Credentials: the password reader-password.",
  },
  oidc: {
    auth: {
      type: "clientCredentials",
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: "pulse-reader",
      audience: "camunda",
    },
    login:
      "Set Credentials: the client secret reader-secret. Operate's browser login does not work here: inside the stack, Keycloak is keycloak:8080.",
  },
}

function containerTool() {
  for (const tool of ["podman", "docker"]) {
    try {
      execFileSync(tool, ["--version"], { stdio: "ignore" })
      return tool
    } catch {
      continue
    }
  }
  throw new Error("Neither podman nor docker is installed.")
}

function container(...args) {
  execFileSync(containerTool(), args, { stdio: "ignore" })
}

function removeQuietly(...args) {
  try {
    container(...args)
  } catch {
    return
  }
}

function startContainer({ name, image, environment, options, command = [] }) {
  const variables = Object.entries(environment).flatMap(([key, value]) => ["-e", `${key}=${value}`])
  const network = ["--network", NETWORK, ...options]
  container("run", "-d", "--name", name, ...network, ...variables, image, ...command)
}

async function waitUntil(check, what, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (!(await check().catch(() => false))) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}.`)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

function down() {
  for (const name of [CAMUNDA, KEYCLOAK, ELASTICSEARCH]) {
    removeQuietly("rm", "-f", name)
  }
  removeQuietly("network", "rm", NETWORK)
}

async function startKeycloak() {
  const realm = fileURLToPath(new URL("keycloak-realm.json", SUPPORT))
  startContainer({
    name: KEYCLOAK,
    image: SETTINGS.images.keycloak,
    environment: SETTINGS.keycloak,
    options: [
      ...["--network-alias", "keycloak", "-p", `${KEYCLOAK_PORT}:8080`],
      ...["-v", `${realm}:/opt/keycloak/data/import/pulse.json:ro`],
    ],
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
    options: ["--network-alias", "elasticsearch"],
  })
  const answers = async () => {
    container("exec", ELASTICSEARCH, "curl", "-sf", "http://localhost:9200")
    return true
  }
  await waitUntil(answers, "Elasticsearch to start", STARTUP_MS)
}

async function startCamunda(storage, security) {
  const ports = ["-p", `${REST_PORT}:8080`, "-p", `${MONITORING_PORT}:9600`]
  startContainer({
    name: CAMUNDA,
    image: IMAGE,
    environment: {
      ...SETTINGS.camunda,
      ...SETTINGS.storage[storage],
      ...SETTINGS.security[security],
    },
    options: ["--network-alias", "camunda", ...ports],
  })
  await waitUntil(
    async () => (await fetch(`http://localhost:${MONITORING_PORT}/actuator/health/status`)).ok,
    "Camunda 8 to start",
    STARTUP_MS,
  )
}

async function bearerToken() {
  const answer = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: "pulse-seed",
      client_secret: "seed-secret",
    }),
  })
  const { access_token: token } = await answer.json()
  return `Bearer ${token}`
}

async function seedHeaders(security) {
  if (security === "basic") {
    return { Authorization: `Basic ${Buffer.from("seed:seed-password").toString("base64")}` }
  }
  return security === "oidc" ? { Authorization: await bearerToken() } : {}
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
  const json = { "Content-Type": "application/json" }
  return {
    get: (path) => call(path),
    post: (path, body) => call(path, { method: "POST", headers: json, body: JSON.stringify(body) }),
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

function orders() {
  return Object.entries(ROUTES).flatMap(([version, { from, routes }]) =>
    routes.split(" ").map((route, index) => [`ORD-${String(from + index)}`, version, route]),
  )
}

async function startAll(calls, definitions) {
  const start = (version, businessId, variables) =>
    calls.post("/process-instances", {
      processDefinitionKey: definitions[version],
      businessId,
      variables,
    })
  for (const [businessId, version, route] of orders()) {
    await start(version, businessId, { route, amount: 42, customer: "C-77", orderId: businessId })
  }
  for (const businessId of ["DSP-3001", "DSP-3002"]) {
    await start("dispatch", businessId, { orderId: "ORD-1001" })
  }
  await start("waits", "WAIT-4001", { orderId: "ORD-1001" })
}

async function failJobs(calls, type, expected) {
  let failed = 0
  const failNext = async () => {
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
  }
  await waitUntil(failNext, `${expected} jobs of ${type}`, SETTLED_MS)
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
  const exported = async () => {
    const { items } = await calls.post("/incidents/search", { filter: { state: "ACTIVE" } })
    return items.length >= incidents
  }
  await waitUntil(exported, `${incidents} incidents in the secondary storage`, SETTLED_MS)
}

function profileOf(security) {
  const { auth } = READER[security]
  const profile = { url: REST_URL, cockpitUrl: `${ORIGIN}/operate`, flavor: "camunda8" }
  return { profiles: { "c8-local": auth === undefined ? profile : { ...profile, auth } } }
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
  console.log("Its profile for .pulse.json:")
  console.log(JSON.stringify(profileOf(security), undefined, 2))
  console.log(READER[security].login)
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
    choice(values.security, READER, "--security"),
  )
} else if (positionals[0] === "down") {
  down()
} else {
  console.error(
    "Usage: node scripts/c8.mjs up [--security none|basic|oidc] [--storage h2|elasticsearch] | down",
  )
  process.exit(1)
}
