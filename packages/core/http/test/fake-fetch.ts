/**
 * A scripted fetch for the unit tests: each call takes the next step (the last repeats) and
 * records what was sent. The conformance cases run over real sockets instead (loopback.ts).
 */
import type { Platform, TraceEvent } from "../src/index.js"

export interface Call {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: string | undefined
  readonly redirect: RequestRedirect | undefined
  readonly signal: AbortSignal | undefined
}

export type Step = Response | ((call: Call) => Response | Promise<Response>)

/** What undici throws for a failed connection: a TypeError whose cause carries the code. */
export function networkError(code: string): TypeError {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) })
}

export const failWith =
  (error: unknown): Step =>
  () => {
    throw error
  }

async function bodyText(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body === undefined || body === null) return undefined
  return new Response(body).text()
}

async function callOf(input: RequestInfo | URL, init: RequestInit | undefined): Promise<Call> {
  return {
    url: input instanceof Request ? input.url : input.toString(),
    method: init?.method ?? "GET",
    headers: Object.fromEntries(new Headers(init?.headers)),
    body: await bodyText(init?.body),
    redirect: init?.redirect,
    signal: init?.signal ?? undefined,
  }
}

export function scriptedFetch(steps: readonly Step[]) {
  const calls: Call[] = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call = await callOf(input, init)
    calls.push(call)
    // As a real fetch: an aborted signal rejects before anything is sent.
    if (call.signal?.aborted === true)
      throw new DOMException("This operation was aborted", "AbortError")
    const step = steps[Math.min(calls.length, steps.length) - 1]
    if (step === undefined) throw new Error("the script has no step")
    return typeof step === "function" ? step(call) : step.clone()
  }
  return { fetch, calls }
}

/** A platform over a scripted fetch that records its trace. */
export function platformOf(steps: readonly Step[]) {
  const { fetch, calls } = scriptedFetch(steps)
  const events: TraceEvent[] = []
  const platform: Platform = {
    fetch,
    now: () => Date.now(),
    trace: (event) => {
      events.push(event)
    },
  }
  return { platform, calls, events }
}

export const jsonAnswer = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })

export const textAnswer = (text: string, status = 200, contentType = "text/plain") =>
  new Response(text, { status, headers: { "Content-Type": contentType } })

/** A fetch that answers when the signal aborts, as undici does: with its reason. */
export const untilAborted: Step = (call) =>
  new Promise<Response>((_, reject) => {
    call.signal?.addEventListener("abort", () => {
      reject(new DOMException("This operation was aborted", "AbortError"))
    })
  })
