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

function authorization(credentials) {
  if (credentials === undefined) {
    return {}
  }
  const token = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")
  return { Authorization: `Basic ${token}` }
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

export function clusterClient(endpoint, credentials) {
  const headers = authorization(credentials)

  async function call(method, path, body) {
    const response = await fetch(`${endpoint}${path}`, requestInit(method, headers, body))
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
