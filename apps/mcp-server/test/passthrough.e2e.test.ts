import http from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp } from "../src/app.js"
import { stubNeutralEnv } from "./boot-server.js"
import { postToolCall, startRealm } from "./realm.js"

/**
 * Passthrough auth on the wire: the engine gets exactly the bearer token the OAuth gate verified,
 * through the real composition (`createApp`), the Keycloak provider's JWT verifier and the engine
 * module's client. A header that carries a second credential is refused at the gate, so nothing
 * the gate did not check ever reaches an engine.
 */

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")

interface Listening {
  url: string
  close(): Promise<void>
}

async function listen(handler: http.RequestListener): Promise<Listening> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/** An engine that answers every read with nothing and records each request's Authorization. */
async function startEngine() {
  const authorizations: (string | undefined)[] = []
  const server = await listen((req, res) => {
    authorizations.push(req.headers.authorization)
    res.setHeader("content-type", "application/json")
    res.end(req.url?.includes("/count") ? '{"count":0}' : "[]")
  })
  return { ...server, authorizations }
}

let realm: Awaited<ReturnType<typeof startRealm>>
let engine: Awaited<ReturnType<typeof startEngine>>

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  realm = await startRealm()
  engine = await startEngine()
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all([realm.close(), engine.close()])
})

async function bootPassthrough() {
  stubNeutralEnv({
    MCP_URL: "http://localhost",
    MCP_OAUTH_KEYCLOAK_SERVER_URL: realm.url,
    MCP_OAUTH_KEYCLOAK_REALM: "platform",
    MCP_ACTIVE_MODULES: "engine",
    ENGINE_BASE_URL: `${engine.url}/engine-rest`,
    ENGINE_AUTH_TYPE: "passthrough",
  })
  return createApp(process.env, { bundle: { jsPath: FIXTURE_JS } })
}

const listDefinitions = (
  composed: Awaited<ReturnType<typeof bootPassthrough>>,
  authorization: string,
) => postToolCall(composed, authorization, "engine_list_process_definitions", {})

describe("passthrough auth forwards the verified token, and only it", () => {
  it("hands the engine the token the gate verified, without what trails it", async () => {
    const composed = await bootPassthrough()
    const token = realm.sign({ aud: "http://localhost/mcp", sub: "demo" })
    const res = await listDefinitions(composed, `Bearer ${token} trailing-junk`)
    expect(res.status).toBe(200)
    expect(await res.text()).not.toContain('"isError":true')
    expect(engine.authorizations.length).toBeGreaterThan(0)
    expect(new Set(engine.authorizations)).toEqual(new Set([`Bearer ${token}`]))
  })

  it("refuses a second credential behind a valid token before any engine request", async () => {
    const composed = await bootPassthrough()
    const token = realm.sign({ aud: "http://localhost/mcp", sub: "demo" })
    const res = await listDefinitions(composed, `Bearer ${token}, Bearer forged`)
    expect(res.status).toBe(401)
    expect(engine.authorizations).toEqual([])
  })
})
