/**
 * The guards that fail closed: a request not marked as a read counts as a write, a URL with
 * credentials goes nowhere, the deadline holds over a fetch that ignores its signal, and a TLS
 * error after the handshake keeps a write's caveat.
 */
import fc from "fast-check"
import { getEventListeners } from "node:events"
import { describe, expect, it } from "vitest"
import {
  basicCredential,
  createHttp,
  HttpFailure,
  type HttpRequest,
  type Intent,
  noCredential,
  type TraceEvent,
} from "../src/index.js"
import { beforeAbort } from "../src/body.js"
import { failWith, networkError, platformOf, type Step } from "./fake-fetch.js"

const ROOT = "http://engine.test/engine-rest"

function httpOf(steps: readonly Step[], readOnly = false, timeoutMs = 1_000) {
  const fake = platformOf(steps)
  const http = createHttp(
    { url: ROOT, credential: basicCredential("demo", "demo-secret"), timeoutMs, readOnly },
    fake.platform,
  )
  return { http, ...fake }
}

async function failureOf(promise: Promise<unknown>): Promise<HttpFailure> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(HttpFailure)
  return error as HttpFailure
}

/** A request whose intent a JavaScript caller got wrong: neither "read" nor "write". */
const unmarked = (intent: unknown): HttpRequest => ({
  method: "DELETE",
  url: `${ROOT}/process-instance/pi-1`,
  intent: intent as Intent,
})

describe("a request not marked as a read", () => {
  it.each([undefined, "", "READ", "delete"])(
    "counts as a write (%j): refused on a read-only connection",
    async (intent) => {
      const { http, calls } = httpOf([new Response(null, { status: 204 })], true)
      const failure = await failureOf(http.send(unmarked(intent)))
      expect(failure).toMatchObject({ reason: "refused-write", mayHaveApplied: false })
      expect(calls).toHaveLength(0)
    },
  )

  it("keeps the write caveat when it fails after it may have left", async () => {
    const { http } = httpOf([failWith(networkError("ECONNRESET"))])
    const failure = await failureOf(http.send(unmarked(undefined)))
    expect(failure).toMatchObject({ reason: "connection", mayHaveApplied: true })
  })

  it("gets no caller's abort, which a write that left cannot undo", async () => {
    const { http, calls } = httpOf([new Response(null, { status: 204 })])
    const request = { ...unmarked("x"), signal: AbortSignal.abort() }
    expect((await http.send(request)).status).toBe(204)
    expect(calls[0]?.signal?.aborted).toBe(false)
  })
})

describe("a request URL with credentials", () => {
  it.each([
    ["http://demo:S3cretPw@engine.test/engine-rest/x", "user and password"],
    ["http://demo@engine.test/engine-rest/x", "a user alone"],
    ["http://:S3cretPw@engine.test/engine-rest/x", "a password alone"],
  ])("is refused before sending: %s (%s)", async (url) => {
    const { http, calls, events } = httpOf([new Response(null, { status: 204 })])
    const failure = await failureOf(http.send({ method: "GET", url, intent: "read" }))
    expect(failure).toMatchObject({
      reason: "invalid-request",
      code: "credentials",
      mayHaveApplied: false,
      target: `${ROOT}/x`,
    })
    expect(failure.cause).toBeUndefined()
    expect(calls).toHaveLength(0)
    expect(events).toEqual([])
  })

  it("shows its password nowhere, whatever it is", async () => {
    const password = fc.stringMatching(/^[A-Za-z0-9\-._~!$&'()*+,;=]{4,20}$/).map((p) => `Qz${p}`)
    await fc.assert(
      fc.asyncProperty(password, async (secret) => {
        const { http, events } = httpOf([new Response(null, { status: 204 })])
        const url = `http://demo:${secret}@engine.test/engine-rest/x`
        const failure = await failureOf(http.send({ method: "PUT", url, intent: "write" }))
        const shown = [failure.message, failure.target, String(failure.cause), events]
        expect(JSON.stringify(shown)).not.toContain(secret)
      }),
      { numRuns: 30 },
    )
  })
})

describe("the deadline over a fetch that ignores its signal", () => {
  it("fails at the deadline although the fetch never settles", async () => {
    const ignoring: Step = () => new Promise<Response>(() => undefined)
    const { http } = httpOf([ignoring], false, 50)
    const started = Date.now()
    const failure = await failureOf(http.send({ ...unmarked("read"), method: "GET" }))
    expect(failure).toMatchObject({ reason: "deadline", limit: 50, mayHaveApplied: false })
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it("cancels the body of an answer that comes too late, and stops listening", async () => {
    let cancelled = false
    const body = new ReadableStream({
      cancel: () => {
        cancelled = true
      },
    })
    let answer: (response: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => {
      answer = resolve
    })
    const deadline = new AbortController()
    const waiting = beforeAbort(pending, deadline.signal)
    deadline.abort()
    await expect(waiting).rejects.toThrow("aborted")
    expect(getEventListeners(deadline.signal, "abort")).toHaveLength(0)
    answer(new Response(body))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(cancelled).toBe(true)
  })

  it("lets an answer without a body come too late", async () => {
    let answer: (response: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => {
      answer = resolve
    })
    const deadline = new AbortController()
    const waiting = beforeAbort(pending, deadline.signal)
    deadline.abort()
    await expect(waiting).rejects.toThrow("aborted")
    answer(new Response(null, { status: 204 }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it("hands an answer in time on as it is", async () => {
    const response = new Response("{}")
    const deadline = new AbortController()
    expect(await beforeAbort(Promise.resolve(response), deadline.signal)).toBe(response)
    expect(getEventListeners(deadline.signal, "abort")).toHaveLength(0)
  })

  it("lets a fetch that fails, fail, also after the deadline", async () => {
    const deadline = new AbortController()
    const broken = Promise.reject(new TypeError("fetch failed"))
    await expect(beforeAbort(broken, deadline.signal)).rejects.toThrow("fetch failed")
    const late = Promise.reject<Response>(new TypeError("late"))
    late.catch(() => undefined)
    deadline.abort()
    await expect(beforeAbort(late, deadline.signal)).rejects.toThrow()
  })
})

describe("a TLS error after the handshake", () => {
  it("keeps the caveat of a write, which may have left", async () => {
    const code = "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC"
    const { http } = httpOf([failWith(networkError(code))])
    const write = await failureOf(http.send(unmarked("write")))
    expect(write).toMatchObject({ reason: "connection", code, mayHaveApplied: true })
  })

  it("is the handshake for a name the certificate does not hold: nothing sent", async () => {
    const code = "ERR_TLS_CERT_ALTNAME_INVALID"
    const { http } = httpOf([failWith(networkError(code))])
    const write = await failureOf(http.send(unmarked("write")))
    expect(write).toMatchObject({ reason: "tls", code, mayHaveApplied: false })
    expect(write.message).toBe(
      `DELETE ${ROOT}/process-instance/pi-1: the TLS handshake failed (${code})`,
    )
  })
})

describe("a trace", () => {
  it("carries no event for a request refused before sending", async () => {
    const events: TraceEvent[] = []
    const http = createHttp(
      { url: ROOT, credential: noCredential, timeoutMs: 1_000 },
      { fetch: globalThis.fetch, now: Date.now, trace: (event) => events.push(event) },
    )
    await failureOf(http.send({ method: "GET", url: `${ROOT}/a/../b`, intent: "read" }))
    expect(events).toEqual([])
  })
})
