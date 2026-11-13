/**
 * Shared fixtures of the HTTP client tests (src/http/client*.test.ts): a fetch that answers in
 * turn and records each call, a JSON answer, and a client over a fetch.
 */

import { vi } from "vitest"
import { noAuth } from "../../src/auth/none.js"
import { type Client, type ClientOptions, createClient } from "../../src/http/client.js"
import type { HttpRequest } from "../../src/http/types.js"

export const ROOT = "http://localhost:8080/engine-rest"
export const URL_ = `${ROOT}/process-instance`

export const REQUEST: HttpRequest = {
  method: "GET",
  url: URL_,
  intent: "read",
  headers: { Accept: "application/json", "X-Tenant": "acme" },
}

export interface Call {
  readonly url: string
  readonly init: RequestInit
  /** The headers sent, by lower-case name. */
  readonly headers: Readonly<Record<string, string>>
}

/** A fetch that answers with `outcomes` in turn and records each call. */
export function fakeFetch(...outcomes: (Response | Error | (() => Promise<Response>))[]) {
  const calls: Call[] = []
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {}, headers: Object.fromEntries(new Headers(init?.headers)) })
    const next = outcomes.shift()
    if (next === undefined) return Promise.reject(new Error("unexpected fetch call"))
    if (next instanceof Error) return Promise.reject(next)
    return typeof next === "function" ? next() : Promise.resolve(next)
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

export function json(status: number, body: unknown = {}, statusText = ""): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  })
}

/** A client over `fetch` for ROOT, without auth unless given. */
export function httpClient(
  fetch: typeof globalThis.fetch,
  overrides: Partial<ClientOptions> = {},
): Client {
  const options = { url: ROOT, fetch, auth: noAuth(), timeoutMs: 1000, now: () => 0 }
  return createClient({ ...options, ...overrides })
}
