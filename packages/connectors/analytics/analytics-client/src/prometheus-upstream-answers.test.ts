import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  createPrometheusClient,
  PrometheusRequestError,
  type PrometheusConfig,
} from "./prometheus.js"

/** What another service or a proxy can answer in Prometheus's place, and what the client makes of it. */

const PASSWORD = "hunter2-pass"

type Answer = [status: number, type: string, body: string]

const asJson = (status: number, body: unknown): Answer => [
  status,
  "application/json",
  JSON.stringify(body),
]

const answers: Record<string, () => Answer> = {
  "success-object": () => asJson(200, { status: "success", data: { id: 1, name: "x" } }),
  "success-array": () => asJson(200, { status: "success", data: [{ id: 1 }] }),
  "row-without-value": () =>
    asJson(200, { status: "success", data: { resultType: "vector", result: [{ foo: 1 }] } }),
  "row-without-metric": () =>
    asJson(200, {
      status: "success",
      data: { resultType: "vector", result: [{ value: [1, "2"] }] },
    }),
  "error-without-text": () => asJson(200, { status: "error", error: { nested: true } }),
  "error-empty-text": () => asJson(200, { status: "error", error: " " }),
  "http-error-without-text": () => asJson(422, { status: "error", error: { nested: true } }),
  "empty-page": () => [502, "text/html; charset=utf-8", ""],
  // A proxy's plain text about the target it was given (http-proxy-middleware's wording).
  "proxy-echo": () => [
    504,
    "text/plain",
    `Error occurred while trying to proxy: ${new URL(url).host}/api/v1/query?query=up`,
  ],
  "url-echo": () => [502, "text/plain", `connect to ${url}/api/v1/query failed`],
  "hostname-echo": () => [503, "text/plain", `upstream ${new URL(url).hostname} refused`],
  "path-echo": () => [404, "text/plain", "Cannot GET /prometheus/api/v1/query"],
  "username-echo": () => [401, "text/plain", "user grafana is not allowed"],
}

// Matched by comparison against the fixed table, never looked up by the query
// string (no dispatch through inherited properties like "constructor").
const table = Object.entries(answers)

const upstream = http.createServer((req, res) => {
  const query = new URL(req.url ?? "/", "http://x").searchParams.get("query")
  const answer = table.find(([name]) => name === query)?.[1]
  const [status, type, body] = answer ? answer() : asJson(500, { unknown: query })
  res.writeHead(status, { "Content-Type": type })
  res.end(body)
})

let url = ""

beforeAll(async () => {
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
  url = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
})

afterAll(async () => {
  upstream.closeAllConnections()
  await new Promise<void>((resolve) => upstream.close(() => resolve()))
})

async function failure(
  query: string,
  config: Partial<PrometheusConfig> = {},
): Promise<PrometheusRequestError> {
  const error = await createPrometheusClient({ url, ...config })
    .instant(query)
    .then(
      () => {
        throw new Error("expected the query to fail")
      },
      (e: unknown) => e,
    )
  expect(error).toBeInstanceOf(PrometheusRequestError)
  return error as PrometheusRequestError
}

describe("an answer that is not Prometheus's", () => {
  it.each([
    "success-object",
    "success-array",
    "row-without-value",
    "row-without-metric",
    "error-without-text",
    "error-empty-text",
  ])("%s: a 200 reads as a failure, not as a crash", async (query) => {
    const error = await failure(query)
    expect(error.message).toBe("Prometheus query error: unknown")
    expect(error.kind).toBe("foreign-answer")
  })

  it("a refusal whose envelope carries no message counts as foreign too", async () => {
    expect((await failure("http-error-without-text")).kind).toBe("foreign-answer")
  })

  it("an empty answer is no web page, whatever its type says", async () => {
    expect((await failure("empty-page")).message).toBe(
      "Prometheus query failed (502): Bad Gateway, empty response body",
    )
  })
})

describe("an upstream's text", () => {
  it.each<[string, string]>([
    [
      "proxy-echo",
      "Prometheus query failed (504): Error occurred while trying to proxy: ***/api/v1/query?query=up",
    ],
    ["url-echo", "Prometheus query failed (502): connect to ***/api/v1/query failed"],
    ["hostname-echo", "Prometheus query failed (503): upstream *** refused"],
  ])("%s: never carries the target", async (query, expected) => {
    const { message } = await failure(query)
    expect(message).toBe(expected)
    expect(message).not.toContain(new URL(url).port)
  })

  it("never carries the URL's path", async () => {
    expect((await failure("path-echo", { url: `${url}/prometheus` })).message).toBe(
      "Prometheus query failed (404): Cannot GET ***/api/v1/query",
    )
  })

  it("never carries the username, configured or in the URL", async () => {
    const expected = "Prometheus query failed (401): user *** is not allowed"
    const configured = await failure("username-echo", { username: "grafana", password: PASSWORD })
    expect(configured.message).toBe(expected)
    const inUrl = await failure("username-echo", {
      url: url.replace("http://", `http://grafana:${PASSWORD}@`),
    })
    expect(inUrl.message).toBe(expected)
  })
})
