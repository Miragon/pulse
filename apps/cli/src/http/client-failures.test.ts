/** What fails without an answer, as the CLI words it: over the transport and for the OAuth client. */

import { bearerCredential, type FailureReason, type Http, HttpFailure } from "@miragon/pulse-http"
import { describe, expect, it, vi } from "vitest"
import { fakeFetch, httpClient, json, REQUEST, ROOT, URL_ } from "../../test/support/http-client.js"
import type { AuthProvider } from "../auth/types.js"
import { PulseCliError } from "../errors.js"
import { send } from "./client.js"

async function failure(promise: Promise<unknown>): Promise<PulseCliError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PulseCliError))
    throw new Error(`expected PulseCliError, got ${String(error)}`)
  return error
}

const fetchFailed = (cause: unknown) => new TypeError("fetch failed", { cause })

const HINTS = {
  tls: "The TLS certificate is not trusted. Point NODE_EXTRA_CA_CERTS to your CA bundle.",
  dns: "The host name does not resolve. Check --url, PULSE_CLI_URL or your profile.",
  generic:
    "Is the engine running? Check --url, PULSE_CLI_URL or `pulse config show`. Run `pulse ping` to test the connection.",
}

describe("send: failures", () => {
  it("turns the deadline into a TIMEOUT error", async () => {
    const waiting = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason as Error)
          })
        }),
    )
    const error = await failure(send(REQUEST, httpClient(waiting, { timeoutMs: 5 })))
    expect(error.code).toBe("TIMEOUT")
    expect(error.exitCode).toBe(8)
    expect(error.message).toBe("Request timed out after 5 ms")
    expect(error.details).toEqual({
      request: { method: "GET", url: URL_ },
      hint: "Increase the timeout with --timeout <ms> or PULSE_CLI_TIMEOUT, or check the engine load.",
    })
    expect(error.cause).toMatchObject({ reason: "deadline" })
  })

  it("wraps network errors with the system error code", async () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8080"), {
      code: "ECONNREFUSED",
    })
    const thrown = fetchFailed(cause)
    const { fetch } = fakeFetch(thrown)
    const error = await failure(send(REQUEST, httpClient(fetch)))
    expect(error.code).toBe("NETWORK")
    expect(error.exitCode).toBe(8)
    expect(error.message).toBe(`Cannot reach ${URL_} (ECONNREFUSED)`)
    expect(error.details).toEqual({ request: { method: "GET", url: URL_ }, hint: HINTS.generic })
    expect(error.cause).toMatchObject({ reason: "unreachable", cause: thrown })
  })

  it.each([
    ["DEPTH_ZERO_SELF_SIGNED_CERT", HINTS.tls],
    ["ENOTFOUND", HINTS.dns],
    ["ECONNRESET", HINTS.generic],
  ])("hints for %s as before", async (code, hint) => {
    const { fetch } = fakeFetch(fetchFailed({ code }))
    const error = await failure(send(REQUEST, httpClient(fetch)))
    expect([error.message, error.details.hint]).toEqual([`Cannot reach ${URL_} (${code})`, hint])
  })

  it("fails with a network error when reading the body fails", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }))
      },
    })
    const { fetch } = fakeFetch(new Response(body))
    const error = await failure(send(REQUEST, httpClient(fetch)))
    expect(error.message).toBe(`Cannot reach ${URL_} (UND_ERR_SOCKET)`)
  })

  it("reports a 3xx as a redirect, never followed, without the target's query", async () => {
    const location = "https://sso.example.com/login?state=x&token=tok-4711#f"
    const { fetch, calls } = fakeFetch(new Response("", { status: 302, headers: { location } }))
    const error = await failure(send(REQUEST, httpClient(fetch)))
    expect(error).toMatchObject({
      code: "HTTP_REDIRECT",
      exitCode: 3,
      message: "HTTP 302 Found: redirect to https://sso.example.com/login",
      details: { status: 302, request: { method: "GET", url: URL_ } },
    })
    expect(error.details.hint).not.toContain("auth status")
    expect(calls).toHaveLength(1)
    const oauth: AuthProvider = {
      ...httpClient(fetch).auth,
      loginStatusCommand: "pulse auth status",
    }
    const again = fakeFetch(new Response("", { status: 307 }))
    const redirect = await failure(send(REQUEST, httpClient(again.fetch, { auth: oauth })))
    expect(redirect.message).toBe("HTTP 307 Temporary Redirect: redirect")
    expect(redirect.details.hint).toMatch(/`pulse auth status` shows whether the OAuth login/)
  })

  it("masks the request's secrets in where a redirect pointed", async () => {
    const location = `${ROOT}/tok-secret-4711/login`
    const auth: AuthProvider = {
      type: "bearer",
      credential: bearerCredential({
        renewable: false,
        token: () => Promise.resolve("tok-secret-4711"),
        rejected: () => Promise.resolve(false),
      }),
    }
    const { fetch } = fakeFetch(new Response("", { status: 302, headers: { location } }))
    const error = await failure(send(REQUEST, httpClient(fetch, { auth })))
    expect(error.message).toBe(`HTTP 302 Found: redirect to ${ROOT}/***/login`)
  })

  it.each([
    ["UND_ERR_INVALID_ARG", "invalid keep-alive header"],
    ["UND_ERR_NOT_SUPPORTED", "expect header not supported"],
  ])("reports undici's %s as an invalid request (USAGE)", async (code, message) => {
    const { fetch } = fakeFetch(fetchFailed(Object.assign(new Error(message), { code })))
    const error = await failure(send(REQUEST, httpClient(fetch)))
    expect(error.code).toBe("USAGE")
    expect(error.message).toBe(`Cannot send GET ${URL_}: invalid request (${message})`)
    expect(error.details.hint).toContain("hop-by-hop headers such as Connection")
  })

  it("reports what the transport refuses to send as an invalid request, nothing sent", async () => {
    const { fetch, calls } = fakeFetch(json(200))
    const client = httpClient(fetch)
    const withBody = await failure(send({ ...REQUEST, body: "{}" }, client))
    expect(withBody.message).toBe(`Cannot send GET ${URL_}: invalid request (body)`)
    expect(withBody.details.hint).toMatch(/^A GET or HEAD request carries no body/)
    const header = await failure(send({ ...REQUEST, headers: { "X-A": "a\nb" } }, client))
    expect(header.message).toBe(`Cannot send GET ${URL_}: invalid request (header)`)
    expect(header.details.hint).toContain("hop-by-hop headers")
    const dots = await failure(send({ ...REQUEST, url: `${ROOT}/x/../y` }, client))
    expect(dots.message).toBe(`Cannot send GET ${ROOT}/x/../y: invalid request (dot-segment)`)
    expect(dots.details.hint).toMatch(/^Check the URL \(--url/)
    expect(calls).toEqual([])
  })

  it("reports a credential the transport refuses as CONFIG, never its value", async () => {
    const auth: AuthProvider = {
      type: "bearer",
      credential: bearerCredential({
        renewable: false,
        token: () => Promise.resolve("tok\nen-4711"),
        rejected: () => Promise.resolve(false),
      }),
    }
    const { fetch, calls } = fakeFetch(json(200))
    const error = await failure(send(REQUEST, httpClient(fetch, { auth })))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(`Cannot send GET ${URL_}: the credential is refused (token-syntax)`)
    expect(JSON.stringify(error.details)).not.toContain("4711")
    expect(calls).toEqual([])
  })

  it("passes on what a credential throws itself (an OAuth login that is missing)", async () => {
    const missing = new PulseCliError("LOGIN_REQUIRED", "Not logged in")
    const auth: AuthProvider = {
      type: "oauth",
      credential: bearerCredential({
        renewable: true,
        token: () => Promise.reject(missing),
        rejected: () => Promise.resolve(false),
      }),
    }
    const { fetch } = fakeFetch(json(200))
    await expect(send(REQUEST, httpClient(fetch, { auth }))).rejects.toBe(missing)
  })
})

describe("send: what the CLI's connection never meets", () => {
  const UNEXPECTED: readonly FailureReason[] = [
    "too-large",
    "refused-write",
    "unauthorized",
    "status",
    "invalid-answer",
  ]
  for (const reason of UNEXPECTED) {
    it(`reports ${reason} as an INTERNAL error, never as an engine out of reach`, async () => {
      const thrown = new HttpFailure(reason, {
        method: "GET",
        target: URL_,
        mayHaveApplied: false,
      })
      const http = { send: () => Promise.reject(thrown) } as unknown as Http
      const client = { ...httpClient(fakeFetch().fetch), http }
      const error = await failure(send(REQUEST, client))
      expect(error.code).toBe("INTERNAL")
      expect(error.exitCode).toBe(1)
      expect(error.message).toBe(`GET ${URL_} failed unexpectedly (${reason})`)
      expect(error.details).toEqual({
        request: { method: "GET", url: URL_ },
        hint: "This is likely a bug in pulse. Re-run with --verbose for the stack trace and report it at https://github.com/Miragon/pulse/issues.",
      })
      expect(error.cause).toBe(thrown)
    })
  }
})
