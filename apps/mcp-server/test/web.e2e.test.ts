import { readFile } from "node:fs/promises"
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
  type FakeOidcOptions,
} from "@miragon/pulse-widget-shell/testing/oidc"
import { createApp } from "../src/app.js"
import { stubNeutralEnv } from "./boot-server.js"
import { postToolCall } from "./realm.js"

/**
 * The web app's calls through the real composition (`createApp`): a page signs in at the fake
 * identity provider, and each of its calls goes in-process to `/mcp` with the session's token, so
 * the OAuth gate, the toolset OAuth gives (operations), the engine profiles, passthrough and the
 * per-caller caches decide as for any client. `/mcp` refuses the session cookie, `/app` a bearer.
 * With `MCP_WEB_SESSION_CHECK_MINUTES` the session is checked at the provider on any replica, at
 * Keycloak and at Microsoft Entra ID, whose single sign-out leaves the session's refresh token
 * alive, while an admin's "Revoke sessions" ends it.
 */

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")
const FIXTURE_WEB = path.join(import.meta.dirname, "fixtures", "web")
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

/**
 * The server under OAuth with the web app on, signing in at `idp` through the boot's provider of
 * its flavor (Keycloak's, or Entra ID's): `prod` forwards the caller's token, `ro` too, read-only;
 * `extra` sets further variables.
 */
function boot(idp: FakeOidc = fake, extra: Record<string, string> = {}): Promise<ComposedServer> {
  const profile = { url: engine.url, auth: { type: "passthrough" } }
  stubNeutralEnv({
    ...idp.env(ORIGIN),
    MCP_WEB_CLIENT_ID: FAKE_OIDC_CLIENT.id,
    MCP_WEB_CLIENT_SECRET: FAKE_OIDC_CLIENT.secret,
    MCP_WEB_SESSION_KEYS: Buffer.alloc(32, 7).toString("base64url"),
    MCP_ACTIVE_MODULES: "engine",
    ENGINE_BASE_URL: undefined,
    ENGINES_JSON: JSON.stringify({
      defaultProfile: "prod",
      profiles: { prod: profile, ro: { ...profile, readOnly: true } },
    }),
    ...extra,
  })
  return createApp(process.env, { bundle: { jsPath: FIXTURE_JS }, webDir: FIXTURE_WEB })
}

/** What a browser keeps: its cookies and the CSRF token its page read. */
interface Jar {
  readonly cookies: Map<string, string>
  csrf: string
}

/** A browser of the app's page on one replica: its cookies, its CSRF token, its calls. */
class Page {
  constructor(
    private readonly composed: ComposedServer,
    private readonly idp: FakeOidc = fake,
    private readonly jar: Jar = { cookies: new Map(), csrf: "" },
  ) {}

  /** The same browser on another replica, its cookies and CSRF token with it. */
  on(replica: ComposedServer): Page {
    return new Page(replica, this.idp, this.jar)
  }

  get cookies(): ReadonlyMap<string, string> {
    return this.jar.cookies
  }

  async fetch(target: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set("host", "localhost")
    const cookie = this.cookieHeader
    if (cookie) headers.set("cookie", cookie)
    const response = await this.composed.app.fetch(
      new Request(new URL(target, ORIGIN), { ...init, headers }),
    )
    for (const set of response.headers.getSetCookie()) {
      const [pair] = set.split(";")
      const at = pair.indexOf("=")
      if (/Max-Age=0(;|$)/.test(set)) this.jar.cookies.delete(pair.slice(0, at))
      else this.jar.cookies.set(pair.slice(0, at), pair.slice(at + 1))
    }
    return response
  }

  get cookieHeader(): string {
    return [...this.jar.cookies].map(([name, value]) => `${name}=${value}`).join("; ")
  }

  /** The whole sign-in as `username`, then the session's CSRF token. */
  async signIn(username?: string): Promise<this> {
    const login = await this.fetch("/app/auth/login")
    await this.fetch(await this.idp.signIn(String(login.headers.get("location")), username))
    const session = await this.fetch("/app/api/session")
    this.jar.csrf = ((await session.json()) as { csrf: string }).csrf
    return this
  }

  /** A call of a server tool as the page sends it. */
  async call(name: string, args: Record<string, unknown> = {}) {
    const response = await this.fetch("/app/api/call", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "sec-fetch-site": "same-origin",
        "x-pulse-csrf": this.jar.csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name, arguments: args }),
    })
    const text = await response.text()
    const setCookies = response.headers.getSetCookie()
    return {
      status: response.status,
      text,
      body: JSON.parse(text) as Record<string, unknown>,
      setCookies,
    }
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

  it("refuses the sign-in's ID token at /mcp, also where an audience mapper adds the resource to it", async () => {
    await fake.close()
    fake = await startFakeOidc({ audience: `${ORIGIN}/mcp`, audienceInIdToken: true })
    const composed = await boot()
    const page = await new Page(composed).signIn()
    expect((await page.call("engine_list_engines")).status).toBe(200)
    const [idToken] = fake.issued.id
    expect(JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString())).toMatchObject({
      aud: [FAKE_OIDC_CLIENT.id, `${ORIGIN}/mcp`],
      typ: "ID",
    })
    const refused = await postToolCall(composed, `Bearer ${idToken}`, "engine_list_engines", {})
    expect(refused.status).toBe(401)
    expect(refused.headers.get("www-authenticate")).toMatch(/error="invalid_token"/)
  })
})

describe("the web build the root names", () => {
  it("shows its page behind the sign-in, with the security headers of /app", async () => {
    const page = new Page(await boot())
    const signedOut = await page.fetch("/app/cockpit?view=jobs")
    expect(signedOut.status).toBe(302)
    expect(signedOut.headers.get("location")).toBe(
      "/app/auth/login?return=%2Fapp%2Fcockpit%3Fview%3Djobs",
    )
    await page.signIn()
    const shown = await page.fetch("/app/cockpit?view=jobs")
    expect(shown.status).toBe(200)
    expect(await shown.text()).toBe(await readFile(path.join(FIXTURE_WEB, "index.html"), "utf8"))
    expect(shown.headers.get("cache-control")).toBe("no-store")
    expect(shown.headers.get("content-security-policy")).toMatch(/^default-src 'none'; /)
  })
})

describe("a web session checked at the provider every five minutes, on two replicas", () => {
  const MINUTE = 60_000
  const READ = "engine_list_engines"
  const SIGNED_OUT = { code: "signed_out", message: "No session: sign in again." }
  let idp: FakeOidc | undefined

  beforeEach(() => {
    // Only the clock is faked: sockets and the deadlines of their requests run as ever.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await idp?.close()
    idp = undefined
  })

  /** Two replicas over one session key and one provider of access tokens of an hour. */
  async function replicas(options: FakeOidcOptions = {}) {
    const started = await startFakeOidc({
      audience: `${ORIGIN}/mcp`,
      accessTokenSeconds: 3600,
      ...options,
    })
    idp = started
    const check = { MCP_WEB_SESSION_CHECK_MINUTES: "5" }
    const one = await boot(started, check)
    const two = await boot(started, check)
    const page = await new Page(one, started).signIn()
    return { one, two, page, provider: started }
  }

  const later = (minutes: number) => vi.setSystemTime(Date.now() + minutes * MINUTE)

  const refreshes = (provider: FakeOidc) =>
    provider.requests.filter((request) => request.form.get("grant_type") === "refresh_token")

  it("ends the session on either replica within the check once the provider ended it, and a new sign-in works", async () => {
    const { one, two, page, provider } = await replicas()
    // The provider ends this browser's session (a sign-out elsewhere, a disabled user).
    const hint = encodeURIComponent(provider.issued.id[0])
    const logout = `${provider.issuer}/protocol/openid-connect/logout?id_token_hint=${hint}`
    expect((await fetch(logout)).status).toBe(200)
    later(4)
    expect((await page.call(READ)).status).toBe(200)
    expect(refreshes(provider)).toEqual([])
    // The check's first refusal at each replica may be a race with the other's renewal.
    later(1)
    for (const replica of [one, two]) expect((await page.on(replica).call(READ)).status).toBe(200)
    later(0.5)
    for (const replica of [one, two]) {
      const { status, body, setCookies } = await page.on(replica).call(READ)
      expect({ status, body, setCookies }).toEqual({
        status: 401,
        body: SIGNED_OUT,
        setCookies: [],
      })
    }
    // 54 minutes before the access token expires. No replica recorded a sign-out: the cookies stay.
    expect(refreshes(provider)).toHaveLength(4)
    expect([...page.cookies.keys()]).toEqual(["__Host-pulse-session"])
    await page.signIn()
    for (const replica of [one, two]) expect((await page.on(replica).call(READ)).status).toBe(200)
  })

  it("keeps the session where the page's parallel calls renew on both replicas and the provider rotates", async () => {
    const { two, page, provider } = await replicas({ rotateRefreshTokens: true })
    for (const round of [1, 2]) {
      later(5)
      const answers = await Promise.all([page.call(READ), page.on(two).call(READ)])
      expect(
        answers.map(({ status }) => status),
        `check ${round}`,
      ).toEqual([200, 200])
      // One replica renewed and set the cookie; the other's refusal was the race's, its first.
      expect(answers.filter(({ setCookies }) => setCookies.length > 0)).toHaveLength(1)
      later(0.5)
      expect((await page.call(READ)).status).toBe(200)
      expect((await page.on(two).call(READ)).status).toBe(200)
    }
    expect(refreshes(provider)).toHaveLength(4)
  })

  it("ends the session at the next check where the provider revokes every token of a reused one", async () => {
    // Auth0's reuse detection without a reuse interval: such a provider needs one replica per
    // browser, as the docs say.
    const { two, page } = await replicas({ revokeFamilyOnReuse: true })
    later(5)
    const answers = await Promise.all([page.call(READ), page.on(two).call(READ)])
    expect(answers.map(({ status }) => status)).toEqual([200, 200])
    later(5)
    expect((await page.call(READ)).status).toBe(200)
    later(0.5)
    expect(await page.call(READ)).toMatchObject({ status: 401, body: SIGNED_OUT })
  })

  it("signs in without a refresh token, and its session ends when its access token expires", async () => {
    const warned = vi.mocked(console.warn)
    const { page, provider } = await replicas({ refreshTokens: false })
    const lines = warned.mock.calls.map(([line]) => String(line))
    expect(lines.filter((line) => line.includes("offline_access"))).toHaveLength(1)
    // Nothing renews it, so nothing checks it: the token goes out until it expires.
    later(5)
    expect((await page.call(READ)).status).toBe(200)
    later(55)
    expect(await page.call(READ)).toMatchObject({ status: 401, body: SIGNED_OUT })
    expect(refreshes(provider)).toEqual([])
  })

  it("starts a caller's caches afresh with each renewed token, so the check refills them", async () => {
    // The per-caller caches key on the token (D18): the XML cache reads the engine again.
    const { page, provider } = await replicas()
    const read = { processDefinitionId: "invoice:1", engine: "prod" }
    for (const step of [0, 0, 5]) {
      later(step)
      expect((await page.call("engine_bpmn_xml_data", read)).status).toBe(200)
    }
    const xmlReads = engine.seen.filter((request) => request.path.endsWith("/xml"))
    expect(xmlReads.map((request) => request.authorization)).toEqual(
      provider.issued.access.map((token) => `Bearer ${token}`),
    )
    expect(provider.issued.access).toHaveLength(2)
  })
})

describe("a web session at Microsoft Entra ID, checked every five minutes on two replicas", () => {
  const MINUTE = 60_000
  const READ = "engine_list_engines"
  const SIGNED_OUT = { code: "signed_out", message: "No session: sign in again." }
  let idp: FakeOidc | undefined

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await idp?.close()
    idp = undefined
  })

  const later = (minutes: number) => vi.setSystemTime(Date.now() + minutes * MINUTE)

  /** The fake tenant with access tokens of an hour, as Entra ID's last 60 to 90 minutes. */
  async function tenant(options: FakeOidcOptions = {}) {
    const started = await startFakeOidc({ flavor: "entra", accessTokenSeconds: 3600, ...options })
    idp = started
    return started
  }

  /** Two replicas over one session key at the tenant, and a page signed in on the first. */
  async function replicas() {
    const provider = await tenant()
    const check = { MCP_WEB_SESSION_CHECK_MINUTES: "5" }
    const one = await boot(provider, check)
    const two = await boot(provider, check)
    const page = await new Page(one, provider).signIn()
    return { one, two, page, provider }
  }

  const grants = (provider: FakeOidc, type: string) =>
    provider.requests.filter((request) => request.form.get("grant_type") === type)

  const apiScope = (provider: FakeOidc) =>
    `${String(provider.entra?.appIdUris[0])}/${String(provider.entra?.scope)}`

  it("signs in through the tenant's v2.0 authority, and /mcp takes the session's v2 token", async () => {
    const { one, page, provider } = await replicas()
    expect((await page.call(READ)).status).toBe(200)
    const [exchange] = grants(provider, "authorization_code")
    expect(exchange.path).toBe(`/${String(provider.entra?.tenant)}/oauth2/v2.0/token`)
    expect(exchange.form.has("resource")).toBe(false)
    expect(exchange.form.get("scope")).toBe(`openid profile offline_access ${apiScope(provider)}`)
    const [access] = provider.issued.access
    expect(JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString())).toMatchObject({
      iss: provider.issuer,
      aud: provider.entra?.apiClientId,
      ver: "2.0",
      scp: "user_impersonation",
    })
    const direct = await postToolCall(one, `Bearer ${access}`, READ, {})
    expect(direct.status).toBe(200)
  })

  it("keeps the session after a single sign-out at Entra ID, and ends it at the next check on a second replica once an admin revoked its sessions", async () => {
    const { two, page, provider } = await replicas()
    // The browser signs out of Entra ID elsewhere: its session there ends, its refresh tokens live.
    const sid = String(provider.sessionOf(provider.issued.refresh[0]))
    const logout = `${provider.serverUrl}/${String(provider.entra?.tenant)}/oauth2/v2.0/logout`
    await fetch(logout, { headers: { cookie: `KEYCLOAK_SESSION=${sid}` } })
    expect(provider.endedSessions).toEqual([expect.objectContaining({ sid })])
    later(5)
    expect((await page.call(READ)).status).toBe(200)
    expect(grants(provider, "refresh_token")).toHaveLength(1)
    // An admin's "Revoke sessions": every renewal is refused from now on.
    provider.refuseRefresh()
    later(5)
    expect((await page.on(two).call(READ)).status).toBe(200)
    later(0.5)
    expect(await page.on(two).call(READ)).toMatchObject({ status: 401, body: SIGNED_OUT })
    expect(grants(provider, "refresh_token")).toHaveLength(3)
  })

  it("fails a sign-in whose group claims overflow the session's cookies, naming the token's size", async () => {
    const provider = await tenant({ groups: true })
    const page = new Page(await boot(provider), provider)
    const login = await page.fetch("/app/auth/login")
    const back = await provider.signIn(String(login.headers.get("location")))
    const callback = await page.fetch(back)
    expect(callback.headers.get("location")).toBe("/app/signed-out?reason=failed")
    const [access] = provider.issued.access
    const lines = vi.mocked(console.warn).mock.calls.map(([line]) => String(line))
    expect(lines.at(-1)).toContain(
      `more than its cookies hold (its access token holds ${access.length} bytes and carries a groups claim).`,
    )
  })
})
