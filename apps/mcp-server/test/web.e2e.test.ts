import http from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ComposedServer } from "@miragon/pulse-widget-shell/server"
import {
  FAKE_OIDC_CLIENT,
  FAKE_OIDC_USERS,
  startFakeOidc,
  type FakeOidc,
} from "@miragon/pulse-widget-shell/testing/oidc"
import { createApp } from "../src/app.js"
import { stubNeutralEnv } from "./boot-server.js"
import { postToolCall } from "./realm.js"

/**
 * The web app's calls through the real composition (`createApp`): a page signs in at the fake
 * identity provider, and each of its calls goes in-process to `/mcp` with the session's token, so
 * the OAuth gate, the toolset OAuth gives (operations), the engine profiles, passthrough and the
 * per-caller caches decide as for any client. `/mcp` refuses the session cookie, `/app` a bearer.
 */

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")
const ORIGIN = "http://localhost"
const XML = '<?xml version="1.0"?><definitions id="d"/>'

/** An engine that answers every read with nothing, its XML with a diagram, and records each. */
async function startEngine() {
  const seen: { path: string; authorization: string | undefined }[] = []
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://engine").pathname
    seen.push({ path: pathname, authorization: req.headers.authorization })
    res.setHeader("content-type", "application/json")
    if (pathname.endsWith("/xml")) res.end(JSON.stringify({ id: "invoice:1", bpmn20Xml: XML }))
    else res.end(pathname.endsWith("/count") ? '{"count":0}' : "[]")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/engine-rest`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

let fake: FakeOidc
let engine: Awaited<ReturnType<typeof startEngine>>

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  fake = await startFakeOidc({ audience: `${ORIGIN}/mcp` })
  engine = await startEngine()
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all([fake.close(), engine.close()])
})

/** The server under OAuth with the web app on: `prod` forwards the caller's token, `ro` too, read-only. */
function boot(): Promise<ComposedServer> {
  const profile = { url: engine.url, auth: { type: "passthrough" } }
  stubNeutralEnv({
    MCP_URL: ORIGIN,
    MCP_OAUTH_KEYCLOAK_SERVER_URL: fake.serverUrl,
    MCP_OAUTH_KEYCLOAK_REALM: fake.realm,
    MCP_WEB_CLIENT_ID: FAKE_OIDC_CLIENT.id,
    MCP_WEB_CLIENT_SECRET: FAKE_OIDC_CLIENT.secret,
    MCP_WEB_SESSION_KEYS: Buffer.alloc(32, 7).toString("base64url"),
    MCP_ACTIVE_MODULES: "engine",
    ENGINE_BASE_URL: undefined,
    ENGINES_JSON: JSON.stringify({
      defaultProfile: "prod",
      profiles: { prod: profile, ro: { ...profile, readOnly: true } },
    }),
  })
  return createApp(process.env, { bundle: { jsPath: FIXTURE_JS } })
}

/** A browser of the app's page: its cookies, its CSRF token, its calls. */
class Page {
  private readonly cookies = new Map<string, string>()
  private csrf = ""

  constructor(private readonly composed: ComposedServer) {}

  async fetch(target: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set("host", "localhost")
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ")
    if (cookie) headers.set("cookie", cookie)
    const response = await this.composed.app.fetch(
      new Request(new URL(target, ORIGIN), { ...init, headers }),
    )
    for (const set of response.headers.getSetCookie()) {
      const [pair] = set.split(";")
      const at = pair.indexOf("=")
      if (/Max-Age=0(;|$)/.test(set)) this.cookies.delete(pair.slice(0, at))
      else this.cookies.set(pair.slice(0, at), pair.slice(at + 1))
    }
    return response
  }

  get cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ")
  }

  /** The whole sign-in as `username`, then the session's CSRF token. */
  async signIn(username?: string): Promise<this> {
    const login = await this.fetch("/app/auth/login")
    await this.fetch(await fake.signIn(String(login.headers.get("location")), username))
    const session = await this.fetch("/app/api/session")
    this.csrf = ((await session.json()) as { csrf: string }).csrf
    return this
  }

  /** A call of a server tool as the page sends it. */
  async call(name: string, args: Record<string, unknown> = {}) {
    const response = await this.fetch("/app/api/call", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "sec-fetch-site": "same-origin",
        "x-pulse-csrf": this.csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name, arguments: args }),
    })
    const text = await response.text()
    return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown> }
  }
}

/** The JSON-RPC result of `/mcp`'s answer, in JSON or as an event stream. */
async function rpcResultOf(response: Response): Promise<unknown> {
  const text = await response.text()
  const json = text.trimStart().startsWith("{")
    ? text
    : (text.split("\n").find((line) => line.startsWith("data: ")) ?? "").slice("data: ".length)
  return (JSON.parse(json) as { result: unknown }).result
}

/** The JSON a tool's result carries in its first text block. */
const feedOf = (body: Record<string, unknown>) =>
  JSON.parse(
    (body as { result: { content: { text: string }[] } }).result.content[0].text,
  ) as Record<string, unknown>

describe("a page's calls through the real server", () => {
  it("run under the operations toolset OAuth gives, with the engines' profiles as /mcp has them", async () => {
    const composed = await boot()
    const page = await new Page(composed).signIn()
    const gate = await page.call("engine_widget_actions_data")
    expect(gate.status).toBe(200)
    const viaPage = feedOf(gate.body)
    expect(viaPage.allowedActions).toEqual(expect.arrayContaining(["engine_set_job_retries"]))
    expect(viaPage.readOnlyEngines).toEqual(["ro"])
    // The same token at /mcp itself gets the same answer.
    const direct = await postToolCall(
      composed,
      `Bearer ${fake.issued.access[0]}`,
      "engine_widget_actions_data",
      {},
    )
    expect(await rpcResultOf(direct)).toEqual(gate.body.result)
    const engines = feedOf((await page.call("engine_list_engines")).body)
    expect(engines.defaultEngineId).toBe("prod")
  })

  it("never reaches a write, an admin tool or a model read no view calls", async () => {
    const page = await new Page(await boot()).signIn()
    const refused = []
    for (const name of [
      "engine_set_job_retries",
      "engine_fetch_and_lock",
      "engine_list_process_definitions",
    ]) {
      const { status, body } = await page.call(name, { engine: "ro" })
      refused.push([name, status, body.code])
    }
    expect(refused).toEqual([
      ["engine_set_job_retries", 403, "WEB_READ_ONLY"],
      ["engine_fetch_and_lock", 403, "WEB_NOT_FOR_PAGES"],
      ["engine_list_process_definitions", 403, "WEB_NOT_FOR_PAGES"],
    ])
    expect(engine.seen).toEqual([])
  })

  it("hands the engine exactly the session's token under passthrough, and the page no token", async () => {
    const page = await new Page(await boot()).signIn()
    const { status, text } = await page.call("engine_jobs_data", { engine: "prod" })
    expect(status).toBe(200)
    expect(text).not.toContain('"isError":true')
    expect(engine.seen.length).toBeGreaterThan(0)
    const [access] = fake.issued.access
    expect(new Set(engine.seen.map((request) => request.authorization))).toEqual(
      new Set([`Bearer ${access}`]),
    )
    for (const token of [...fake.issued.access, ...fake.issued.refresh, ...fake.issued.id]) {
      expect(text).not.toContain(token)
    }
  })

  it("keeps the per-caller caches apart for two users", async () => {
    const composed = await boot()
    const alice = await new Page(composed).signIn(FAKE_OIDC_USERS[0].username)
    const bob = await new Page(composed).signIn(FAKE_OIDC_USERS[1].username)
    const read = { processDefinitionId: "invoice:1", engine: "prod" }
    for (const page of [alice, alice, bob]) {
      const { status, body } = await page.call("engine_bpmn_xml_data", read)
      expect(status).toBe(200)
      expect(feedOf(body)).toMatchObject({ bpmnXml: XML })
    }
    // Alice's second read comes from her cache; Bob's is his own, with his own token.
    const xmlReads = engine.seen.filter((request) => request.path.endsWith("/xml"))
    expect(xmlReads.map((request) => request.authorization)).toEqual([
      `Bearer ${fake.issued.access[0]}`,
      `Bearer ${fake.issued.access[1]}`,
    ])
  })

  it("keeps the two credentials apart: /mcp refuses the session cookie, /app a bearer", async () => {
    const composed = await boot()
    const page = await new Page(composed).signIn()
    const withCookie = await composed.app.fetch(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        headers: {
          host: "localhost",
          cookie: page.cookieHeader,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    )
    expect(withCookie.status).toBe(401)
    expect(withCookie.headers.get("www-authenticate")).toMatch(/^Bearer /)
    const withBearer = await composed.app.fetch(
      new Request(`${ORIGIN}/app/api/session`, {
        headers: { host: "localhost", authorization: `Bearer ${fake.issued.access[0]}` },
      }),
    )
    expect(withBearer.status).toBe(400)
  })
})
