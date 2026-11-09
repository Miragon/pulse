import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createEngineClient, withCallerSignal } from "./client.js"
import { USER_AGENT } from "./hey-api.js"

/**
 * The User-Agent the engine logs: the package's name and the version
 * release-please keeps in `package.json` (and bumps on the annotated line in
 * `hey-api.ts`), so a stale copy fails here instead of in an operator's
 * access-log filter.
 */
const { name, version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string }

const BASE = "http://localhost:8410/engine-rest"

interface Sent {
  request: Request
  init: RequestInit | undefined
}

/** A `fetch` that records each request and answers `{}`. */
function recording(): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = []
  const record: typeof fetch = (input, init) => {
    sent.push({ request: input as Request, init })
    return Promise.resolve(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    )
  }
  return { fetch: record, sent }
}

describe("createEngineClient", () => {
  it("sends every request through the fetch it is given, as the finished Request", async () => {
    const { fetch, sent } = recording()
    const client = createEngineClient({ baseUrl: BASE, fetch })
    await client.get({ url: "/engine" })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.request).toBeInstanceOf(Request)
    expect(sent[0]?.request.url).toBe(`${BASE}/engine`)
    // No init of its own: the transport behind the fetch owns signal, redirects and deadline.
    expect(sent[0]?.init).toBeUndefined()
  })

  it("adds no credential: the transport behind its fetch signs each request", async () => {
    const { fetch, sent } = recording()
    await createEngineClient({ baseUrl: BASE, fetch }).get({
      url: "/engine",
      security: [{ scheme: "basic", type: "http" }],
    })
    expect(sent[0]?.request.headers.has("Authorization")).toBe(false)
  })

  it("always sends the JSON content negotiation headers and identifies itself", async () => {
    expect(USER_AGENT).toBe(`${name}/${version}`)
    const { fetch, sent } = recording()
    const client = createEngineClient({ baseUrl: BASE, fetch })
    const configured = client.getConfig().headers as Headers
    expect(configured.get("Content-Type")).toBe("application/json")
    expect(configured.get("Accept")).toBe("application/json")
    await client.get({ url: "/engine" })
    expect(sent[0]?.request.headers.get("Accept")).toBe("application/json")
    expect(sent[0]?.request.headers.get("User-Agent")).toBe(USER_AGENT)
  })

  it("runs the request validator on the call's options before anything is built or sent", async () => {
    const { fetch, sent } = recording()
    const seen: unknown[] = []
    const client = createEngineClient({
      baseUrl: BASE,
      fetch,
      requestValidator: (options) => {
        seen.push((options as { path?: unknown }).path)
        const id = (options as { path?: { id?: string } }).path?.id
        return id === ".." ? Promise.reject(new Error("refused")) : Promise.resolve()
      },
    })
    await client.get({ url: "/process-instance/{id}", path: { id: "pi-1" } })
    await expect(client.get({ url: "/process-instance/{id}", path: { id: ".." } })).rejects.toThrow(
      "refused",
    )
    expect(seen).toEqual([{ id: "pi-1" }, { id: ".." }])
    expect(sent.map((s) => s.request.url)).toEqual([`${BASE}/process-instance/pi-1`])
  })

  it("refuses a call that brings its own fetch, which would leave the transport out", async () => {
    const { fetch, sent } = recording()
    const own = recording()
    const client = createEngineClient({ baseUrl: BASE, fetch })
    const message = /may not bring its own fetch/
    await expect(client.get({ url: "/engine", fetch: own.fetch })).rejects.toThrow(message)
    await expect(client.post({ url: "/engine", fetch: own.fetch })).rejects.toThrow(message)
    await expect(
      client.request({ method: "DELETE", url: "/engine", fetch: own.fetch }),
    ).rejects.toThrow(message)
    await expect(client.sse.get({ url: "/engine", fetch: own.fetch })).rejects.toThrow(message)
    expect(() => client.setConfig({ fetch: own.fetch })).toThrow(message)
    // A call view keeps the refusal, and calls without one still send.
    const view = withCallerSignal(client, new AbortController().signal)
    await expect(view.get({ url: "/engine", fetch: own.fetch })).rejects.toThrow(message)
    await view.get({ url: "/engine" })
    client.setConfig({ throwOnError: true })
    await client.put({ url: "/engine" })
    expect(own.sent).toHaveLength(0)
    expect(sent).toHaveLength(2)
  })

  it("refuses a call's own requestValidator or auth, even undefined: it would skip the client's", async () => {
    const { fetch, sent } = recording()
    const client = createEngineClient({
      baseUrl: BASE,
      fetch,
      requestValidator: () => Promise.reject(new Error("refused by the client's validator")),
    })
    const call = { url: "/process-instance/{id}/variables", path: { id: ".." } }
    await expect(client.get({ ...call, requestValidator: undefined })).rejects.toThrow(
      /may not bring its own requestValidator/,
    )
    await expect(client.get({ ...call, auth: "tok-own" })).rejects.toThrow(
      /may not bring its own auth/,
    )
    await expect(
      client.sse.get({ ...call, requestValidator: () => Promise.resolve() }),
    ).rejects.toThrow(/may not bring its own requestValidator/)
    expect(() => client.setConfig({ requestValidator: undefined })).toThrow(
      /may not bring its own requestValidator/,
    )
    expect(() => client.setConfig({ auth: "tok-own" })).toThrow(/may not bring its own auth/)
    // The client's own validator still runs on a call without either.
    await expect(client.get(call)).rejects.toThrow("refused by the client's validator")
    expect(sent).toHaveLength(0)
  })

  it("normalizes a trailing slash off the base URL", () => {
    const client = createEngineClient({ baseUrl: `${BASE}/`, fetch: recording().fetch })
    expect(client.getConfig().baseUrl).toBe(BASE)
  })
})

describe("withCallerSignal", () => {
  it("hands the caller's signal to reads only, a call's own signal first", async () => {
    const { fetch, sent } = recording()
    const caller = new AbortController()
    const own = new AbortController()
    const client = withCallerSignal(createEngineClient({ baseUrl: BASE, fetch }), caller.signal)
    await client.get({ url: "/engine" })
    await client.get({ url: "/engine", signal: own.signal })
    await client.post({ url: "/engine" })
    caller.abort()
    const [read, ownRead, write] = sent.map((s) => s.request.signal)
    expect(read?.aborted).toBe(true)
    expect(ownRead?.aborted).toBe(false)
    expect(write?.aborted).toBe(false)
  })

  it("returns the client unchanged without a signal", () => {
    const client = createEngineClient({ baseUrl: BASE, fetch: recording().fetch })
    expect(withCallerSignal(client, undefined)).toBe(client)
  })
})
