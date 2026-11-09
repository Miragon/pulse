import { describe, expect, it } from "vitest"
import { basicCredential, createHttp, HttpFailure } from "../src/index.js"
import { recordingFetch } from "../src/testing/index.js"

const ROOT = "http://engine.test/engine-rest"

describe("recordingFetch", () => {
  it("records each request as it would reach the socket, and plays the script in order", async () => {
    const fake = recordingFetch([
      new Response("first"),
      (request) => new Response(`second ${request.method}`, { status: 201 }),
    ])
    const first = await fake.fetch(`${ROOT}/a/./b?x=1`, { headers: { "X-One": "1" } })
    const second = await fake.fetch(new Request(`${ROOT}/c`, { method: "POST", body: "{}" }), {
      redirect: "manual",
    })
    expect([await first.text(), await second.text(), second.status]).toEqual([
      "first",
      "second POST",
      201,
    ])
    expect(fake.requests).toEqual([
      {
        method: "GET",
        url: `${ROOT}/a/b?x=1`,
        headers: { "x-one": "1" },
        body: undefined,
        initKeys: ["headers"],
        redirect: "follow",
      },
      {
        method: "POST",
        url: `${ROOT}/c`,
        headers: { "content-type": "text/plain;charset=UTF-8" },
        body: "{}",
        initKeys: ["redirect"],
        redirect: "manual",
      },
    ])
    expect(fake.unused()).toBe(0)
  })

  it("hands a scripted function the request with its body unread", async () => {
    const fake = recordingFetch([async (request) => new Response(await request.text())])
    const answer = await fake.fetch(`${ROOT}/x`, { method: "PUT", body: "same bytes" })
    expect(await answer.text()).toBe("same bytes")
    expect(fake.requests[0]?.body).toBe("same bytes")
  })

  it("names a request beyond the script and counts the entries no request took", async () => {
    const empty = recordingFetch([])
    await expect(empty.fetch(`${ROOT}/x`)).rejects.toThrow(
      "recordingFetch: no answer for request 1",
    )
    expect(empty.requests).toHaveLength(1)
    expect(empty.unused()).toBe(0)
    const spare = recordingFetch([new Response(null), new Response(null), new Response(null)])
    await spare.fetch(`${ROOT}/x`)
    expect(spare.unused()).toBe(2)
  })

  it("fails as Node's fetch does for a system code", async () => {
    const fake = recordingFetch([{ fail: "ECONNREFUSED" }])
    const error: unknown = await fake.fetch(`${ROOT}/x`).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(TypeError)
    expect(error).toMatchObject({ message: "fetch failed", cause: { code: "ECONNREFUSED" } })
    expect((error as { cause: Error }).cause.message).toBe("ECONNREFUSED")
  })

  it("rejects an aborted signal before recording anything, as fetch does", async () => {
    const fake = recordingFetch([new Response(null)])
    await expect(fake.fetch(`${ROOT}/x`, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
      message: "This operation was aborted",
    })
    expect(fake.requests).toEqual([])
    expect(fake.unused()).toBe(1)
  })

  it("hangs before the headers or in the body until the signal aborts", async () => {
    const fake = recordingFetch([{ hang: "headers" }, { hang: "body" }])
    const caller = new AbortController()
    const pending = fake.fetch(`${ROOT}/x`, { signal: caller.signal })
    caller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    const body = new AbortController()
    const answer = await fake.fetch(`${ROOT}/y`, { signal: body.signal })
    expect(answer.status).toBe(200)
    const reading = answer.text()
    body.abort()
    await expect(reading).rejects.toMatchObject({ name: "AbortError" })
  })

  it("drives the transport: the deadline in the body, the code of a failed connection", async () => {
    const fake = recordingFetch([{ hang: "body" }, { fail: "ECONNRESET" }])
    const http = createHttp(
      { url: ROOT, credential: basicCredential("demo", "demo-secret"), timeoutMs: 50 },
      { fetch: fake.fetch, now: Date.now },
    )
    const read = { method: "GET", url: `${ROOT}/x`, intent: "read" } as const
    await expect(http.send(read)).rejects.toMatchObject({ reason: "deadline" })
    const failure: unknown = await http
      .send({ ...read, method: "DELETE", intent: "write" })
      .catch((thrown: unknown) => thrown)
    expect(failure).toBeInstanceOf(HttpFailure)
    expect(failure).toMatchObject({
      reason: "connection",
      code: "ECONNRESET",
      mayHaveApplied: true,
    })
    expect(
      fake.requests.map((request) => [request.redirect, request.headers.authorization]),
    ).toEqual([
      ["manual", "Basic ZGVtbzpkZW1vLXNlY3JldA=="],
      ["manual", "Basic ZGVtbzpkZW1vLXNlY3JldA=="],
    ])
    expect(fake.requests[0]?.initKeys).toEqual(["headers", "method", "redirect", "signal"])
  })
})
