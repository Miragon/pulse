import { readFile } from "node:fs/promises"

function plainValue(value) {
  if (typeof value === "bigint") {
    return JSON.rawJSON(String(value))
  }
  return value instanceof Date ? value.toISOString() : value
}

export function clusterVariables(variables) {
  return Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, plainValue(value)]),
  )
}

const RETRIES = 5
const BUSY = new Set([429, 503])
const EARLY_MS = 60_000

export function basicLogin({ username, password }) {
  const token = Buffer.from(`${username}:${password}`).toString("base64")
  return { headers: () => Promise.resolve({ Authorization: `Basic ${token}` }) }
}

async function tokenOf({ tokenEndpoint, clientId, clientSecret, audience }) {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      ...(audience === undefined ? {} : { audience }),
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || typeof body.access_token !== "string") {
    throw new Error(
      `The token endpoint answered HTTP ${response.status} ${body.error ?? ""}`.trim(),
    )
  }
  return { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 300) * 1000 }
}

export function clientCredentialsLogin(client) {
  let token
  return {
    async headers() {
      if (token === undefined || token.expiresAt - EARLY_MS < Date.now()) {
        token = await tokenOf(client)
      }
      return { Authorization: `Bearer ${token.value}` }
    },
  }
}

function requestInit(method, headers, body) {
  if (body === undefined || body instanceof FormData) {
    return { method, headers, body }
  }
  return {
    method,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

async function deploymentForm(name, file) {
  const form = new FormData()
  const xml = await readFile(file, "utf8")
  form.append("resources", new Blob([xml], { type: "application/xml" }), `${name}.bpmn`)
  return form
}

async function answerOf(endpoint, login, request) {
  for (let attempt = 1; ; attempt++) {
    const headers = login === undefined ? {} : await login.headers()
    const response = await fetch(
      `${endpoint}${request.path}`,
      requestInit(request.method, headers, request.body),
    )
    if (!BUSY.has(response.status) || attempt === RETRIES) {
      return response
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
  }
}

export function clusterClient(endpoint, login) {
  async function call(method, path, body) {
    const response = await answerOf(endpoint, login, { method, path, body })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`${method} ${path}: HTTP ${response.status} ${text}`)
    }
    return text === "" ? undefined : JSON.parse(text)
  }

  const post = (path, body) => call("POST", path, body)

  return {
    endpoint,
    get: (path) => call("GET", path),
    post,
    put: (path, body) => call("PUT", path, body),
    patch: (path, body) => call("PATCH", path, body),
    search: async (path, filter, limit = 100) =>
      (await post(path, { filter, page: { limit } })).items,
    count: async (path, filter) =>
      (await post(path, { filter, page: { limit: 1 } })).page.totalItems,
    isReady: async () => JSON.stringify(await call("GET", "/topology")).includes('"leader"'),
    async deploy(name, file) {
      const { deployments } = await call("POST", "/deployments", await deploymentForm(name, file))
      return deployments.map(({ processDefinition }) => processDefinition)
    },
  }
}
