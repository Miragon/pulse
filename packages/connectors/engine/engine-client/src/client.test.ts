import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createEngineClient } from "./client.js"

/**
 * The User-Agent the engine logs: the package's name and the version
 * release-please keeps in `package.json` (and bumps on the annotated line in
 * `hey-api.ts`), so a stale copy fails here instead of in an operator's
 * access-log filter.
 */
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string }
const USER_AGENT = `@miragon/pulse-engine-client/${version}`

afterEach(() => {
  vi.unstubAllGlobals()
})

function headers(client: ReturnType<typeof createEngineClient>): Headers {
  return client.getConfig().headers as Headers
}

describe("createEngineClient", () => {
  it("sends Basic auth built from username/password", () => {
    const client = createEngineClient({
      baseUrl: "http://localhost:8410/engine-rest",
      authType: "basic",
      username: "demo",
      password: "secret",
    })
    expect(headers(client).get("Authorization")).toBe(
      `Basic ${Buffer.from("demo:secret").toString("base64")}`,
    )
  })

  it("sends Bearer auth from the configured token", () => {
    const client = createEngineClient({
      baseUrl: "http://localhost:8410/engine-rest",
      authType: "bearer",
      token: "tok-123",
    })
    expect(headers(client).get("Authorization")).toBe("Bearer tok-123")
  })

  it("omits the Authorization header for authType none and for incomplete credentials", () => {
    const none = createEngineClient({ baseUrl: "http://localhost:8410/engine-rest" })
    expect(headers(none).get("Authorization")).toBeNull()

    const incompleteBasic = createEngineClient({
      baseUrl: "http://localhost:8410/engine-rest",
      authType: "basic",
      username: "demo", // no password
    })
    expect(headers(incompleteBasic).get("Authorization")).toBeNull()

    const tokenlessBearer = createEngineClient({
      baseUrl: "http://localhost:8410/engine-rest",
      authType: "bearer",
    })
    expect(headers(tokenlessBearer).get("Authorization")).toBeNull()
  })

  it("passthrough: sets no static Authorization header", () => {
    const client = createEngineClient({
      baseUrl: "http://localhost:8410/engine-rest",
      authType: "passthrough",
      tokenProvider: () => "tok-123",
    })
    expect(headers(client).get("Authorization")).toBeNull()
  })

  it("passthrough: re-evaluates the token provider on every request", async () => {
    let currentToken: string | undefined = "tok-a"
    const seen: Array<string | null> = []
    const fetchStub: typeof fetch = async (input) => {
      seen.push((input as Request).headers.get("Authorization"))
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    const client = createEngineClient({
      baseUrl: "http://localhost:8410/engine-rest",
      authType: "passthrough",
      tokenProvider: () => currentToken,
    })

    await client.get({ url: "/engine", fetch: fetchStub })
    currentToken = "tok-b"
    await client.get({ url: "/engine", fetch: fetchStub })
    currentToken = undefined
    await client.get({ url: "/engine", fetch: fetchStub })

    expect(seen).toEqual(["Bearer tok-a", "Bearer tok-b", null])
  })

  it("passthrough: maps an engine 401 to an actionable error", async () => {
    const unauthorized: typeof fetch = async () => new Response(null, { status: 401 })

    const tokenless = createEngineClient({
      baseUrl: "http://localhost:8410/engine-rest",
      authType: "passthrough",
      tokenProvider: () => undefined,
    })
    await expect(tokenless.get({ url: "/engine", fetch: unauthorized })).rejects.toThrow(
      /^\[401\] empty response body\. The MCP request carried no bearer token to pass through\.$/,
    )

    const rejected = createEngineClient({
      baseUrl: "http://localhost:8410/engine-rest",
      authType: "passthrough",
      tokenProvider: () => "tok-123",
    })
    await expect(rejected.get({ url: "/engine", fetch: unauthorized })).rejects.toThrow(
      /rejected the forwarded bearer token/,
    )
  })

  it("rejects a deadline that is not a positive integer a timer can hold", () => {
    const baseUrl = "http://localhost:8410/engine-rest"
    for (const timeoutMs of [0, -1, 1.5, Number.NaN, 2_147_483_648]) {
      expect(() => createEngineClient({ baseUrl, timeoutMs })).toThrow(RangeError)
    }
    expect(() => createEngineClient({ baseUrl, timeoutMs: 2_147_483_647 })).not.toThrow()
  })

  it("sends every request with a deadline signal that also follows the caller's", async () => {
    let sent: { request?: Request; signal?: AbortSignal | null } = {}
    vi.stubGlobal("fetch", (request: Request, init?: RequestInit) => {
      sent = { request, signal: init?.signal }
      return Promise.resolve(
        new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
      )
    })
    const caller = new AbortController()
    const client = createEngineClient({ baseUrl: "http://localhost:8410/engine-rest" })
    await client.get({ url: "/engine", signal: caller.signal })
    expect(sent.request?.url).toBe("http://localhost:8410/engine-rest/engine")
    expect(sent.signal).toBeInstanceOf(AbortSignal)
    expect(sent.signal?.aborted).toBe(false)
    caller.abort()
    expect(sent.signal?.aborted).toBe(true)
  })

  it("passthrough: leaves the other request headers untouched", async () => {
    let seen: Headers | undefined
    const fetchStub: typeof fetch = async (input) => {
      seen = (input as Request).headers
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    const client = createEngineClient({
      baseUrl: "http://localhost:8410/engine-rest",
      authType: "passthrough",
      tokenProvider: () => "tok-123",
    })
    await client.get({ url: "/engine", fetch: fetchStub })
    expect(seen?.get("Accept")).toBe("application/json")
    expect(seen?.get("User-Agent")).toBe(USER_AGENT)
  })

  it("always sends the JSON content negotiation headers and identifies itself", () => {
    const client = createEngineClient({ baseUrl: "http://localhost:8410/engine-rest" })
    const h = headers(client)
    expect(h.get("Content-Type")).toBe("application/json")
    expect(h.get("Accept")).toBe("application/json")
    expect(h.get("User-Agent")).toBe(USER_AGENT)
  })

  it("normalizes a trailing slash off the base URL", () => {
    const client = createEngineClient({ baseUrl: "http://localhost:8410/engine-rest/" })
    expect(client.getConfig().baseUrl).toBe("http://localhost:8410/engine-rest")
  })
})
