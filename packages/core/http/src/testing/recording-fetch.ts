/**
 * A fake `fetch` for a surface's unit tests, without sockets: it records each request and plays
 * the script's entries in order, one per request. The conformance cases run over real sockets
 * instead, where the network's own codes come from the system.
 */

/** One answer of the script. */
export type Scripted =
  | Response
  | ((request: Request) => Response | Promise<Response>)
  /** Fails as Node's fetch does: a TypeError("fetch failed") whose cause carries this code. */
  | { readonly fail: string }
  /**
   * `headers`: never answers; `body`: answers with the status and headers, never ends the body.
   * Either ends only when the request's signal aborts, with an AbortError, as fetch does.
   */
  | { readonly hang: "headers" | "body" }

/** A request as the fake saw it. */
export interface Recorded {
  readonly method: string
  /** As the `Request` resolved it: what reaches the socket. */
  readonly url: string
  /** Names in lower case. */
  readonly headers: Readonly<Record<string, string>>
  /** The body as text, none for a request without one. */
  readonly body: string | undefined
  /** The keys of the init the fetch was called with (`redirect`, `signal`, never `dispatcher`). */
  readonly initKeys: readonly string[]
  readonly redirect: RequestRedirect
}

export interface RecordingFetch {
  readonly fetch: typeof fetch
  readonly requests: readonly Recorded[]
  /** How many entries of the script no request took. */
  unused(): number
}

const abortError = (): DOMException => new DOMException("This operation was aborted", "AbortError")

/** Calls `then` once `signal` aborts, at once when it has already. */
function onAbort(signal: AbortSignal, then: () => void): void {
  if (signal.aborted) then()
  else signal.addEventListener("abort", then, { once: true })
}

/** Settles never, but rejects with an AbortError once `signal` aborts. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    onAbort(signal, () => {
      reject(abortError())
    })
  })
}

/** A body that never ends, but errors once `signal` aborts. */
function endlessBody(signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      onAbort(signal, () => {
        controller.error(abortError())
      })
    },
  })
}

function failure(code: string): TypeError {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) })
}

async function play(entry: Scripted, request: Request): Promise<Response> {
  if (entry instanceof Response) return entry
  if (typeof entry === "function") return entry(request)
  if ("fail" in entry) throw failure(entry.fail)
  if (entry.hang === "headers") return untilAborted(request.signal)
  return new Response(endlessBody(request.signal))
}

async function recordOf(request: Request, init: RequestInit | undefined): Promise<Recorded> {
  return {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers),
    body: request.body === null ? undefined : await request.text(),
    initKeys: Object.keys(init ?? {}).sort(),
    redirect: request.redirect,
  }
}

/**
 * A `fetch` that answers the n-th request with the n-th entry of `script`. A request beyond the
 * script fails with an Error that names it, an aborted signal rejects before anything is
 * recorded, as fetch does.
 */
export function recordingFetch(script: readonly Scripted[]): RecordingFetch {
  const requests: Recorded[] = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    if (request.signal.aborted) throw abortError()
    const entry = script[requests.length]
    requests.push(await recordOf(request.clone(), init))
    if (entry === undefined) {
      throw new Error(`recordingFetch: no answer for request ${String(requests.length)}`)
    }
    return play(entry, request)
  }
  return { fetch, requests, unused: () => Math.max(0, script.length - requests.length) }
}
