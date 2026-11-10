import { bearerCredential, type TokenSource } from "@miragon/pulse-http"
import { describe, expect, it, vi } from "vitest"
import { basicAuth } from "../auth/basic.js"
import type { AuthProvider } from "../auth/types.js"
import { httpClient, fakeFetch, json, REQUEST, URL_ } from "../../test/support/http-client.js"
import { send } from "./client.js"
import type { HttpRequest, TraceEvent } from "./types.js"

/** A provider whose bearer token renews as `renew` says, counting each 401. */
function renewing(tokens: string[], renew: () => Promise<boolean>): AuthProvider {
  const source: TokenSource = {
    renewable: true,
    token: () => Promise.resolve(tokens[0]),
    rejected: async () => {
      const renewed = await renew()
      if (renewed) tokens.shift()
      return renewed
    },
  }
  return { type: "oauth", credential: bearerCredential(source) }
}

describe("send", () => {
  it("sends method, url, the headers, the body, a deadline and never follows a redirect", async () => {
    const { fetch, calls } = fakeFetch(json(200, { ok: true }, "OK"))
    const auth = renewing(["t"], () => Promise.resolve(false))
    const request: HttpRequest = { ...REQUEST, method: "POST", intent: "write", body: '{"a":1}' }
    await send(request, httpClient(fetch, { auth }))
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe(URL_)
    expect(call?.init.method).toBe("POST")
    expect(call?.init.body).toBe('{"a":1}')
    expect(call?.headers).toEqual({
      accept: "application/json",
      "x-tenant": "acme",
      authorization: "Bearer t",
    })
    expect(call?.init.signal).toBeInstanceOf(AbortSignal)
    expect(call?.init.redirect).toBe("manual")
  })

  it("lets the credential's Authorization replace a request header case-insensitively", async () => {
    const { fetch, calls } = fakeFetch(json(200))
    const request = { ...REQUEST, headers: { authorization: "Basic user", Accept: "*/*" } }
    const auth = basicAuth({
      type: "basic",
      username: "demo",
      password: "demo",
      sources: { username: "flag", password: "flag" },
    })
    await send(request, httpClient(fetch, { auth }))
    expect(calls[0]?.headers).toEqual({ accept: "*/*", authorization: "Basic ZGVtbzpkZW1v" })
  })

  it("omits the body when the request has none", async () => {
    const { fetch, calls } = fakeFetch(json(200))
    await send(REQUEST, httpClient(fetch))
    expect(calls[0]?.init).not.toHaveProperty("body")
  })

  it("returns status, status text, content type, headers and the raw body", async () => {
    const { fetch } = fakeFetch(json(200, { id: "a" }, "OK"))
    const response = await send(REQUEST, httpClient(fetch))
    expect(response.status).toBe(200)
    expect(response.statusText).toBe("OK")
    expect(response.contentType).toBe("application/json")
    expect(response.headers).toEqual({ "content-type": "application/json" })
    expect(new TextDecoder().decode(response.body)).toBe('{"id":"a"}')
  })

  it("fills in the reason phrase when the server sends none (Tomcat)", async () => {
    const events: TraceEvent[] = []
    const { fetch } = fakeFetch(new Response(null, { status: 204 }))
    const response = await send(
      REQUEST,
      httpClient(fetch, { trace: (event) => events.push(event) }),
    )
    expect(response.statusText).toBe("No Content")
    expect(events[1]).toMatchObject({ type: "response", status: 204, statusText: "No Content" })
  })

  it("reports an empty content type when the response has none", async () => {
    const { fetch } = fakeFetch(new Response(null, { status: 204, statusText: "No Content" }))
    const response = await send(REQUEST, httpClient(fetch))
    expect(response.contentType).toBe("")
    expect(response.body).toEqual(new Uint8Array())
  })

  it("reads an answer of any size: the CLI caps none (the transport's default is 64 MiB)", async () => {
    const announced = { "Content-Length": String(65 * 1024 * 1024) }
    const { fetch } = fakeFetch(new Response("x", { status: 200, headers: announced }))
    expect((await send(REQUEST, httpClient(fetch))).body.byteLength).toBe(1)
  })
})

describe("send: a credential that renews", () => {
  it("retries exactly once with the new token when the credential renewed", async () => {
    const { fetch, calls } = fakeFetch(json(401), json(200, { ok: 1 }))
    const renew = vi.fn(() => Promise.resolve(true))
    const response = await send(
      REQUEST,
      httpClient(fetch, { auth: renewing(["old", "new"], renew) }),
    )
    expect(response.status).toBe(200)
    expect(renew).toHaveBeenCalledTimes(1)
    expect(calls.map((call) => call.headers.authorization)).toEqual(["Bearer old", "Bearer new"])
  })

  it("does not retry a second time when the retry is rejected again", async () => {
    const { fetch, calls } = fakeFetch(json(401), json(401, { message: "still" }))
    const renew = vi.fn(() => Promise.resolve(true))
    const response = await send(REQUEST, httpClient(fetch, { auth: renewing(["a", "b"], renew) }))
    expect(response.status).toBe(401)
    expect(renew).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)
  })

  it("returns the 401 when the credential did not renew, or cannot", async () => {
    const { fetch, calls } = fakeFetch(json(401, { first: true }))
    const renew = vi.fn(() => Promise.resolve(false))
    const response = await send(REQUEST, httpClient(fetch, { auth: renewing(["t"], renew) }))
    expect(response.status).toBe(401)
    expect(new TextDecoder().decode(response.body)).toBe('{"first":true}')
    expect(renew).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(1)
    const fixed = fakeFetch(json(401))
    expect((await send(REQUEST, httpClient(fixed.fetch))).status).toBe(401)
    expect(fixed.calls).toHaveLength(1)
  })

  it("propagates an error of the renewal instead of the 401", async () => {
    const { fetch, calls } = fakeFetch(json(401))
    const failure = new Error("revoked")
    const auth = renewing(["t"], () => Promise.reject(failure))
    await expect(send(REQUEST, httpClient(fetch, { auth }))).rejects.toBe(failure)
    expect(calls).toHaveLength(1)
  })

  it.each([200, 400, 403, 404, 500])("does not renew after status %i", async (status) => {
    const { fetch, calls } = fakeFetch(json(status))
    const renew = vi.fn(() => Promise.resolve(true))
    const response = await send(REQUEST, httpClient(fetch, { auth: renewing(["t"], renew) }))
    expect(response.status).toBe(status)
    expect(renew).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
  })
})

describe("send: the secrets of a request in what the engine sends back", () => {
  const echo = (text: string) =>
    new Response(JSON.stringify({ type: "ProcessEngineException", message: text }), {
      status: 500,
      headers: { "content-type": "application/json" },
    })

  it("are masked: the password, the Basic value and the secret extra headers", async () => {
    const auth = basicAuth({
      type: "basic",
      username: "demo",
      password: "demo-secret",
      sources: { username: "env", password: "env" },
    })
    const { fetch } = fakeFetch(echo("pw demo-secret, ZGVtbzpkZW1vLXNlY3JldA== key-4711 tenant-7"))
    const headers = { "X-Api-Key": "key-4711", "X-Tenant": "tenant-7" }
    const request = { ...REQUEST, headers: { ...REQUEST.headers, ...headers } }
    const response = await send(request, httpClient(fetch, { auth, headers }))
    expect(JSON.parse(new TextDecoder().decode(response.body))).toEqual({
      type: "ProcessEngineException",
      message: "pw ***, *** *** tenant-7",
    })
  })
})

describe("send: the trace", () => {
  it("emits the request with its headers as written, secrets masked, and the response", async () => {
    const { fetch } = fakeFetch(json(201, { id: "abc" }, "Created"))
    const events: TraceEvent[] = []
    const times = [100, 142]
    const now = vi.fn(() => times.shift() ?? 0)
    const auth = renewing(["tok-1"], () => Promise.resolve(false))
    const request = { ...REQUEST, method: "POST", intent: "write" } as const
    await send(request, httpClient(fetch, { auth, now, trace: (event) => events.push(event) }))
    expect(events).toEqual([
      {
        type: "request",
        method: "POST",
        url: URL_,
        headers: { Accept: "application/json", "X-Tenant": "acme", Authorization: "Bearer ***" },
        secretHeaders: ["authorization"],
      },
      { type: "response", status: 201, statusText: "Created", durationMs: 42, bytes: 12 },
    ])
  })

  it("shows the secret headers as sent only with --show-secrets", async () => {
    const auth = renewing(["tok-1"], () => Promise.resolve(false))
    const headers = { "X-Api-Key": "key-4711" }
    const request = { ...REQUEST, headers: { ...REQUEST.headers, ...headers } }
    const traced = async (showSecrets: boolean) => {
      const events: TraceEvent[] = []
      const { fetch } = fakeFetch(json(200))
      const trace = (event: TraceEvent) => events.push(event)
      await send(request, httpClient(fetch, { auth, headers, trace, showSecrets }))
      return events[0]
    }
    expect(await traced(false)).toMatchObject({
      headers: { "X-Api-Key": "***", Authorization: "Bearer ***" },
    })
    expect(await traced(true)).toMatchObject({
      headers: { "X-Api-Key": "key-4711", Authorization: "Bearer tok-1" },
    })
  })

  it("emits events for both attempts of a retried request", async () => {
    const { fetch } = fakeFetch(json(401, {}, "Unauthorized"), json(200, [], "OK"))
    const events: TraceEvent[] = []
    const auth = renewing(["a", "b"], () => Promise.resolve(true))
    await send(REQUEST, httpClient(fetch, { auth, trace: (event) => events.push(event) }))
    expect(events.map((event) => event.type)).toEqual([
      "request",
      "response",
      "request",
      "response",
    ])
    expect(events[1]).toMatchObject({ status: 401, statusText: "Unauthorized", bytes: 2 })
    expect(events[3]).toMatchObject({ status: 200, statusText: "OK", bytes: 2 })
  })

  it("emits the answer of a redirect, without a size, before it fails", async () => {
    const moved = new Response(null, {
      status: 302,
      statusText: "Moved Somewhere",
      headers: { Location: "https://login.example/sso" },
    })
    const { fetch } = fakeFetch(moved)
    const events: TraceEvent[] = []
    const times = [100, 105]
    const now = vi.fn(() => times.shift() ?? 0)
    await expect(
      send(REQUEST, httpClient(fetch, { now, trace: (event) => events.push(event) })),
    ).rejects.toMatchObject({ code: "HTTP_REDIRECT" })
    expect(events[1]).toEqual({
      type: "response",
      status: 302,
      statusText: "Moved Somewhere",
      durationMs: 5,
    })
  })

  it("keeps the answer when the trace throws: it only watches", async () => {
    const { fetch } = fakeFetch(json(201, { id: "abc" }, "Created"))
    const trace = vi.fn(() => {
      throw new Error("trace broke")
    })
    const request = { ...REQUEST, method: "POST", intent: "write" } as const
    expect((await send(request, httpClient(fetch, { trace }))).status).toBe(201)
    expect(trace).toHaveBeenCalledTimes(2)
  })

  it("emits only the request event when the request fails", async () => {
    const { fetch } = fakeFetch(new TypeError("fetch failed"))
    const events: TraceEvent[] = []
    await expect(
      send(REQUEST, httpClient(fetch, { trace: (event) => events.push(event) })),
    ).rejects.toMatchObject({ code: "NETWORK" })
    expect(events.map((event) => event.type)).toEqual(["request"])
  })
})
