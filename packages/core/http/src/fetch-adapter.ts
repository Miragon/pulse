/**
 * The transport as a `fetch` for a generated SDK (hey-api calls its `fetch` with the finished
 * Request). The SDK keeps building requests and reading answers; the transport keeps the rest.
 */
import { parseJson } from "./json.js"
import { decodeText, mediaTypeOf } from "./problem.js"
import type { AsFetchOptions, HttpAnswer, HttpRequest } from "./types.js"

/** Statuses whose Response must have no body. */
const NULL_BODY: ReadonlySet<number> = new Set([101, 103, 204, 205, 304])

/** A digit run no safe integer has: only then can an answer hold an integer beyond 2^53. */
const LONG_DIGITS = /\d{16}/

/** The body the SDK reads: with integers beyond 2^53 as exact-digit strings when asked. */
function bodyFor(
  answer: HttpAnswer,
  integers: AsFetchOptions["integers"],
): Uint8Array<ArrayBuffer> {
  if (integers !== "string" || answer.status >= 400) return answer.body
  if (!mediaTypeOf(answer.contentType).includes("json")) return answer.body
  const text = decodeText(answer)
  if (!LONG_DIGITS.test(text)) return answer.body
  try {
    return new TextEncoder().encode(JSON.stringify(parseJson(text, "string")))
  } catch {
    // No JSON: the SDK's own parse says so.
    return answer.body
  }
}

function responseOf(answer: HttpAnswer, integers: AsFetchOptions["integers"]): Response {
  const headers = new Headers(answer.headers)
  // The body is read and decoded already: its length and encoding no longer apply.
  headers.delete("content-length")
  headers.delete("content-encoding")
  const body = NULL_BODY.has(answer.status) ? null : bodyFor(answer, integers)
  return new Response(body, { status: answer.status, statusText: answer.statusText, headers })
}

/** A `fetch` over `send`: see `Http.asFetch`. */
export function fetchOf(
  send: (request: HttpRequest) => Promise<HttpAnswer>,
  options: AsFetchOptions,
): typeof fetch {
  const adapter = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const intent = options.intentOf(request)
    // Read once: a second attempt after a 401 sends the same bytes, no clone, no duplex.
    const body = request.body === null ? undefined : new Uint8Array(await request.arrayBuffer())
    const answer = await send({
      method: request.method,
      url: request.url,
      intent,
      headers: Object.fromEntries(request.headers),
      ...(body === undefined ? {} : { body }),
      // The transport honours it for a read only.
      signal: request.signal,
    })
    return responseOf(answer, options.integers)
  }
  return adapter
}
