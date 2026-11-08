import crypto from "node:crypto"
import http from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp } from "../src/app.js"
import { stubNeutralEnv } from "./boot-server.js"

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

/** A loopback Keycloak realm that serves only its key set; `sign` issues its RS256 tokens. */
async function startRealm() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }
  const server = await listen((_req, res) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return {
    ...server,
    sign(claims: Record<string, unknown>) {
      const exp = Math.floor(Date.now() / 1000) + 3600
      const body = { iss: `${server.url}/realms/platform`, exp, ...claims }
      const signed = `${segment({ alg: "RS256", kid: "k1", typ: "JWT" })}.${segment(body)}`
      const signature = crypto.sign("RSA-SHA256", Buffer.from(signed), privateKey)
      return `${signed}.${signature.toString("base64url")}`
    },
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
) =>
  composed.app.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "engine_list_process_definitions", arguments: {} },
      }),
    }),
  )

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
