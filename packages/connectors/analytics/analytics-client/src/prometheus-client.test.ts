import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createPrometheusClient, withCallerSignal, type PrometheusConfig } from "./prometheus.js"

const TOKEN = "s3cr3t-token"
const PASSWORD = "hunter2-pass"

let lastHeaders: http.IncomingHttpHeaders = {}

const success = {
  status: "success",
  data: {
    resultType: "vector",
    result: [
      { metric: { engine_id: "prod-a" }, value: [1, "42"] },
      { metric: { engine_id: "prod-b" }, value: [1, "NaN"] },
    ],
  },
}

function credentialOf(authorization = ""): string {
  const [scheme, value = ""] = authorization.split(" ")
  return scheme === "Basic" ? Buffer.from(value, "base64").toString().split(":")[1] : value
}

const echoTable: Record<string, (auth?: string) => [number, string, string]> = {
  // A misbehaving proxy: the whole Authorization header…
  "echo-auth": (auth) => [401, "text/plain", `denied: ${auth ?? ""}`],
  // …or only the credential itself.
  "echo-credential": (auth) => [401, "text/plain", `invalid credential ${credentialOf(auth)}`],
  // Envelopes whose errorType is no Prometheus error type.
  "echo-type": (auth) => [
    400,
    "application/json",
    JSON.stringify({ status: "error", errorType: `${"t".repeat(2000)} ${auth}`, error: "nope" }),
  ],
  "api-echo-type": () => [
    200,
    "application/json",
    JSON.stringify({ status: "error", errorType: `bad ${TOKEN}`, error: "nope" }),
  ],
  // A short, Prometheus-shaped errorType that happens to be a configured header value.
  "header-type": () => [
    400,
    "application/json",
    JSON.stringify({ status: "error", errorType: "tenantsecret", error: "nope" }),
  ],
}

// Matched by comparison against the fixed table, never looked up by the query
// string (no dispatch through inherited properties like "constructor").
const echoes = Object.entries(echoTable)

const prometheus = http.createServer((req, res) => {
  lastHeaders = req.headers
  const query = new URL(req.url ?? "/", "http://x").searchParams.get("query") ?? ""
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(body))
  }
  const echo = echoes.find(([q]) => q === query)?.[1]
  if (echo) {
    const [status, type, body] = echo(req.headers.authorization)
    res.writeHead(status, { "Content-Type": type })
    return res.end(body)
  }
  if (query === "hang") return
  if (query === "bad") {
    return json(400, {
      status: "error",
      errorType: "bad_data",
      error: `invalid parameter "query": 1:1: parse error: unexpected ${"x".repeat(2000)}`,
    })
  }
  if (query === "text") {
    res.writeHead(502, { "Content-Type": "text/plain" })
    return res.end(`bad gateway ${"y".repeat(2000)}`)
  }
  if (query === "empty") {
    res.writeHead(503)
    return res.end()
  }
  if (query === "html") {
    res.writeHead(200, { "Content-Type": "text/html" })
    return res.end("<!DOCTYPE html><html><body>Sign in</body></html>")
  }
  if (query === "api-error") {
    return json(200, { status: "error", errorType: "timeout", error: "query timed out" })
  }
  json(200, success)
})

let url = ""
let closedUrl = ""

beforeAll(async () => {
  await new Promise<void>((resolve) => prometheus.listen(0, "127.0.0.1", resolve))
  url = `http://127.0.0.1:${(prometheus.address() as AddressInfo).port}`
  const probe = http.createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const closedPort = (probe.address() as AddressInfo).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  closedUrl = `http://127.0.0.1:${closedPort}`
})

beforeEach(() => {
  lastHeaders = {}
})

afterAll(async () => {
  prometheus.closeAllConnections()
  await new Promise<void>((resolve) => prometheus.close(() => resolve()))
})

const client = (config: Partial<PrometheusConfig> = {}) =>
  createPrometheusClient({ url, ...config })

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => {
      throw new Error("expected the query to fail")
    },
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(Error)
  return (error as Error).message
}

describe("Prometheus queries", () => {
  it("map the labeled samples and drop NaN", async () => {
    expect(await client().instant("up")).toEqual([{ metric: { engine_id: "prod-a" }, value: 42 }])
  })

  it("tolerate a trailing slash on the URL", async () => {
    expect(await client({ url: `${url}/` }).instant("up")).toHaveLength(1)
  })
})

describe("Prometheus auth", () => {
  it("sends no Authorization header by default", async () => {
    await client().instant("up")
    expect(lastHeaders.authorization).toBeUndefined()
  })

  it("sends a bearer token", async () => {
    await client({ bearerToken: TOKEN }).instant("up")
    expect(lastHeaders.authorization).toBe(`Bearer ${TOKEN}`)
  })

  it("sends basic auth from username/password", async () => {
    await client({ username: "grafana", password: PASSWORD }).instant("up")
    expect(lastHeaders.authorization).toBe(
      `Basic ${Buffer.from(`grafana:${PASSWORD}`).toString("base64")}`,
    )
  })

  it("moves URL userinfo into a Basic header (fetch rejects credentialed URLs)", async () => {
    const credentialed = url.replace("http://", `http://grafana:${encodeURIComponent("p@ss:w")}@`)
    await client({ url: credentialed }).instant("up")
    expect(lastHeaders.authorization).toBe(
      `Basic ${Buffer.from("grafana:p@ss:w").toString("base64")}`,
    )
  })

  it("sends custom headers (e.g. a tenant id) next to the auth header", async () => {
    await client({ bearerToken: TOKEN, headers: { "X-Scope-OrgID": "tenant-a" } }).instant("up")
    expect(lastHeaders["x-scope-orgid"]).toBe("tenant-a")
    expect(lastHeaders.authorization).toBe(`Bearer ${TOKEN}`)
  })

  it.each<[string, Partial<PrometheusConfig>]>([
    ["bearer + basic", { bearerToken: TOKEN, username: "u", password: "p" }],
    ["a username without password", { username: "u" }],
    ["a password without username", { password: "p" }],
    ["URL userinfo + explicit credentials", { url: "http://u:p@prom:9090", bearerToken: TOKEN }],
    [
      "an Authorization header + a bearer token",
      { bearerToken: TOKEN, headers: { authorization: "x" } },
    ],
  ])("rejects ambiguous auth at construction: %s", (_, config) => {
    expect(() => client(config)).toThrow(/Prometheus/)
  })

  it("rejects an invalid header without echoing its value", () => {
    expect(() => client({ headers: { "Bad Header": "v4lue-secret" } })).toThrow(/Bad Header/)
    expect(() => client({ headers: { "X-Key": "line\nbreak-secret" } })).toThrow(/X-Key/)
    try {
      client({ headers: { "X-Key": "line\nbreak-secret" } })
    } catch (e) {
      expect((e as Error).message).not.toContain("break-secret")
    }
  })

  it("rejects an invalid URL without echoing it (it may carry credentials)", () => {
    expect(() => client({ url: `not a url ${PASSWORD}` })).toThrow(/not a valid URL/)
    try {
      client({ url: `not a url ${PASSWORD}` })
    } catch (e) {
      expect((e as Error).message).not.toContain(PASSWORD)
    }
  })
})

describe("Prometheus errors reach the model actionable and credential-free", () => {
  it("unreachable: the OS code, no URL, no userinfo", async () => {
    const credentialed = closedUrl.replace("http://", `http://grafana:${PASSWORD}@`)
    const message = await failure(client({ url: credentialed }).instant("up"))
    expect(message).toBe("Prometheus unreachable (ECONNREFUSED)")
  })

  it("a PromQL error: status, errorType, the truncated error text", async () => {
    const message = await failure(client().instant("bad"))
    expect(message).toMatch(
      /^Prometheus query failed \(400 bad_data\): invalid parameter "query": 1:1: parse error: unexpected x+…$/,
    )
    expect(message.length).toBeLessThan(600)
  })

  it("a text body is truncated", async () => {
    const message = await failure(client().instant("text"))
    expect(message).toMatch(/^Prometheus query failed \(502\): bad gateway y+…$/)
    expect(message.length).toBeLessThan(600)
  })

  it("an empty body falls back to the status line", async () => {
    expect(await failure(client().instant("empty"))).toBe(
      "Prometheus query failed (503): Service Unavailable — empty response body",
    )
  })

  it("401: a credential echoed by the upstream is redacted, and the remedy is named", async () => {
    const bearer = await failure(client({ bearerToken: TOKEN }).instant("echo-auth"))
    expect(bearer).not.toContain(TOKEN)
    expect(bearer).toBe(
      "Prometheus query failed (401): denied: Bearer *** — check the configured Prometheus credentials",
    )
    const basic = await failure(
      client({ username: "grafana", password: PASSWORD }).instant("echo-auth"),
    )
    expect(basic).not.toContain(Buffer.from(`grafana:${PASSWORD}`).toString("base64"))
    expect(basic).toContain("denied: Basic ***")
  })

  it("masks a credential echoed alone, also when configured with stray whitespace", async () => {
    // A token read verbatim from a secret file keeps its trailing newline; the
    // header is sent trimmed, so the echo carries the trimmed form.
    expect(await failure(client({ bearerToken: `${TOKEN}\n` }).instant("echo-credential"))).toBe(
      "Prometheus query failed (401): invalid credential *** — check the configured Prometheus credentials",
    )
    // Whitespace inside a password survives the echo but not the collapse.
    const spaced = "hunter2  pass\tword"
    const basic = await failure(
      client({ username: "grafana", password: spaced }).instant("echo-credential"),
    )
    expect(basic).toBe(
      "Prometheus query failed (401): invalid credential *** — check the configured Prometheus credentials",
    )
  })

  it("never echoes an errorType that is no Prometheus error type", async () => {
    expect(await failure(client({ bearerToken: TOKEN }).instant("echo-type"))).toBe(
      "Prometheus query failed (400): nope",
    )
    expect(await failure(client({ bearerToken: TOKEN }).instant("api-echo-type"))).toBe(
      "Prometheus query error: nope",
    )
  })

  it("masks a Prometheus-shaped errorType that is a configured secret", async () => {
    const tenant = client({ headers: { "X-Scope-OrgID": "tenantsecret" } })
    expect(await failure(tenant.instant("header-type"))).toBe(
      "Prometheus query failed (400 ***): nope",
    )
  })

  it("a 200 that is not JSON (a login page) says so instead of a JSON parse error", async () => {
    expect(await failure(client().instant("html"))).toBe(
      "Prometheus returned a non-JSON response (HTTP 200, text/html) — is a proxy or login page in front of it?",
    )
  })

  it("an API-level error", async () => {
    expect(await failure(client().instant("api-error"))).toBe(
      "Prometheus query error (timeout): query timed out",
    )
  })

  it("a hung Prometheus ends at the per-query deadline", async () => {
    const started = Date.now()
    const message = await failure(client({ timeoutMs: 50 }).instant("hang"))
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(message).toBe("Prometheus did not respond within 50 ms (timeout)")
  })

  it("rejects a deadline a timer cannot hold", () => {
    for (const timeoutMs of [0, -1, 1.5, Number.NaN, 2_147_483_648]) {
      expect(() => client({ timeoutMs })).toThrow(RangeError)
    }
  })
})

describe("caller cancellation", () => {
  it("aborts the query when the caller's signal fires", async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)
    const message = await failure(withCallerSignal(client(), controller.signal).instant("hang"))
    expect(message).toBe("Prometheus query cancelled by the caller")
  })

  it("a per-call signal wins over the bound one", async () => {
    const bound = withCallerSignal(client(), new AbortController().signal)
    const message = await failure(bound.instant("hang", { signal: AbortSignal.abort() }))
    expect(message).toBe("Prometheus query cancelled by the caller")
  })

  it("returns the client unchanged without a signal", () => {
    const c = client()
    expect(withCallerSignal(c, undefined)).toBe(c)
  })
})
