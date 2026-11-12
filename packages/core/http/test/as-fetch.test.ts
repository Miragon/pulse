import { describe, expect, it } from "vitest"
import {
  type AsFetchOptions,
  bearerCredential,
  createHttp,
  HttpFailure,
  noCredential,
  type TokenSource,
} from "../src/index.js"
import { jsonAnswer, platformOf, type Step, textAnswer, untilAborted } from "./fake-fetch.js"

const ROOT = "http://engine.test/engine-rest"
const reads: AsFetchOptions = { intentOf: () => "read" }

function fetchOf(
  steps: readonly Step[],
  options: AsFetchOptions = reads,
  credential = noCredential,
) {
  const fake = platformOf(steps)
  const http = createHttp({ url: ROOT, credential, timeoutMs: 1_000 }, fake.platform)
  return { fetch: http.asFetch(options), ...fake }
}

describe("asFetch", () => {
  it("answers a status from 400 on as a Response, as a generated SDK expects", async () => {
    const { fetch } = fetchOf([jsonAnswer({ type: "X", message: "gone" }, 404)])
    const response = await fetch(new Request(`${ROOT}/process-instance/pi-1`))
    expect(response.status).toBe(404)
    expect(response.statusText).toBe("Not Found")
    expect(await response.json()).toEqual({ type: "X", message: "gone" })
  })

  it("fails a redirect with an HttpFailure, never following it", async () => {
    const { fetch, calls } = fetchOf([
      new Response(null, { status: 302, headers: { Location: "/login" } }),
    ])
    await expect(fetch(`${ROOT}/x`)).rejects.toBeInstanceOf(HttpFailure)
    expect(calls[0]?.redirect).toBe("manual")
  })

  it("reads the body once, so the second attempt after a 401 sends the same bytes", async () => {
    let token = "tok-1"
    const source: TokenSource = {
      renewable: true,
      token: () => Promise.resolve(token),
      rejected: () => {
        token = "tok-2"
        return Promise.resolve(true)
      },
    }
    const { fetch, calls } = fetchOf(
      [new Response(null, { status: 401 }), new Response(null, { status: 204 })],
      { intentOf: () => "write" },
      bearerCredential(source),
    )
    const body = JSON.stringify({ messageName: "paid" })
    const request = new Request(`${ROOT}/message`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    })
    const response = await fetch(request)
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
    expect(calls.map((call) => [call.headers.authorization, call.body])).toEqual([
      ["Bearer tok-1", body],
      ["Bearer tok-2", body],
    ])
    expect(calls[1]?.headers["content-type"]).toBe("application/json")
  })

  // The documented limit: the Request resolved the dot segments before the transport saw them,
  // so the path value rule runs before the URL is built (the SDK's requestValidator).
  it("gets the URL the Request resolved already, a dot segment gone", async () => {
    const { fetch, calls } = fetchOf([new Response(null, { status: 204 })], {
      intentOf: () => "write",
    })
    await fetch(new Request(`${ROOT}/process-instance/../variables/amount`, { method: "PUT" }))
    expect(calls.map((call) => call.url)).toEqual([`${ROOT}/variables/amount`])
  })

  it("asks the caller for the intent of each request", async () => {
    const seen: string[] = []
    const { fetch } = fetchOf([jsonAnswer([])], {
      intentOf: (request) => {
        seen.push(`${request.method} ${new URL(request.url).pathname}`)
        return "read"
      },
    })
    await fetch(`${ROOT}/process-instance`, { method: "POST", body: "{}" })
    expect(seen).toEqual(["POST /engine-rest/process-instance"])
  })

  it("hands a read the caller's signal and a write none", async () => {
    const caller = new AbortController()
    const read = fetchOf([untilAborted])
    const pending = read.fetch(`${ROOT}/x`, { signal: caller.signal })
    caller.abort()
    await expect(pending).rejects.toMatchObject({ reason: "cancelled" })
    const write = fetchOf([new Response(null, { status: 204 })], { intentOf: () => "write" })
    const aborted = AbortSignal.abort()
    expect((await write.fetch(`${ROOT}/x`, { method: "DELETE", signal: aborted })).status).toBe(204)
  })

  it("gives integers beyond 2^53 to the SDK as exact-digit strings when asked", async () => {
    const big = '{"value":9223372036854775807,"ratio":0.5,"small":1}'
    const exact = fetchOf([textAnswer(big, 200, "application/json")], {
      ...reads,
      integers: "string",
    })
    expect(await (await exact.fetch(`${ROOT}/x`)).json()).toEqual({
      value: "9223372036854775807",
      ratio: 0.5,
      small: 1,
    })
    const plain = fetchOf([textAnswer(big, 200, "application/json")])
    expect(await (await plain.fetch(`${ROOT}/x`)).text()).toBe(big)
  })

  it("rewrites no body that cannot hold such an integer, is no JSON or is an error", async () => {
    const options: AsFetchOptions = { ...reads, integers: "string" }
    for (const [answer, text] of [
      [textAnswer('{"value":12}', 200, "application/json"), '{"value":12}'],
      [textAnswer("12345678901234567890", 200, "text/plain"), "12345678901234567890"],
      [textAnswer("{12345678901234567890", 200, "application/json"), "{12345678901234567890"],
      [
        textAnswer('{"v":12345678901234567890}', 500, "application/json"),
        '{"v":12345678901234567890}',
      ],
    ] as const) {
      const { fetch } = fetchOf([answer], options)
      expect(await (await fetch(`${ROOT}/x`)).text()).toBe(text)
    }
  })

  it("drops the length and encoding of a body it read already", async () => {
    const answer = new Response("{}", {
      headers: { "Content-Type": "application/json", "Content-Encoding": "gzip", "X-Kept": "1" },
    })
    const { fetch } = fetchOf([answer])
    const response = await fetch(`${ROOT}/x`)
    expect(response.headers.get("content-encoding")).toBeNull()
    expect(response.headers.get("content-length")).toBeNull()
    expect(response.headers.get("x-kept")).toBe("1")
  })
})
