/**
 * From a `fetch` Response to an answer: a 3xx is a failure, the body is read under the deadline
 * and the cap, the standard reason phrase fills in for Tomcat's missing one, and an error answer
 * carries no secret of the request that drew it.
 */
import { readBody } from "./body.js"
import { HttpFailure } from "./failure.js"
import { clipText, maskJsonText, maskSecrets } from "./mask.js"
import { decodeText, mediaTypeOf } from "./problem.js"
import { statusTextOf } from "./status.js"
import type { HttpAnswer, Intent } from "./types.js"
import { targetOf } from "./url.js"

/** What an answer needs of its request. */
export interface Sent {
  readonly method: string
  readonly url: string
  readonly intent: Intent
  /** Origin and path, masked. */
  readonly target: string
  readonly forms: readonly string[]
}

/** The longest redirect target a failure names. */
const MAX_LOCATION = 200

const ignore = (): undefined => undefined

/**
 * Where a 3xx points: origin and path, masked as written and again as parsed (the parser
 * re-encodes a path), cut; none when the Location does not parse.
 */
function locationOf(response: Response, sent: Sent): string | undefined {
  const written = response.headers.get("Location")
  const location = written === null ? null : maskSecrets(written, sent.forms)
  if (location === null || !URL.canParse(location, sent.url)) return undefined
  return clipText(maskSecrets(targetOf(new URL(location, sent.url).href), sent.forms), MAX_LOCATION)
}

function redirectFailure(response: Response, sent: Sent): HttpFailure {
  response.body?.cancel().catch(ignore)
  const location = locationOf(response, sent)
  return new HttpFailure("redirect", {
    method: sent.method,
    target: sent.target,
    status: response.status,
    ...(location === undefined ? {} : { location }),
    // A 3xx comes from in front of the API (a gateway's login, http to https), which applied nothing.
    mayHaveApplied: false,
  })
}

const isTextual = (type: string): boolean =>
  type === "" || type.startsWith("text/") || /json|xml|javascript|x-www-form-urlencoded/.test(type)

function maskedBody(answer: HttpAnswer, forms: readonly string[]): HttpAnswer {
  const type = mediaTypeOf(answer.contentType)
  if (!isTextual(type)) return answer
  const text = decodeText(answer)
  const masked = type.includes("json") ? maskJsonText(text, forms) : maskSecrets(text, forms)
  if (masked === text) return answer
  // Written back as UTF-8, whatever charset the server sent.
  const contentType = `${type === "" ? "text/plain" : type}; charset=utf-8`
  return {
    ...answer,
    contentType,
    headers: { ...answer.headers, "content-type": contentType },
    body: new TextEncoder().encode(masked),
  }
}

/** An error answer without the request's secrets: its body, its reason phrase, its headers. */
function maskedAnswer(answer: HttpAnswer, forms: readonly string[]): HttpAnswer {
  if (forms.length === 0) return answer
  const headers = Object.fromEntries(
    Object.entries(answer.headers).map(([name, value]) => [name, maskSecrets(value, forms)]),
  )
  return maskedBody(
    { ...answer, statusText: maskSecrets(answer.statusText, forms), headers },
    forms,
  )
}

/** The answer to `sent`: a 3xx fails, the body is read to its last byte or fails. */
export async function answerOf(
  response: Response,
  sent: Sent,
  limits: { readonly cap: number; readonly signal: AbortSignal },
): Promise<HttpAnswer> {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    throw redirectFailure(response, sent)
  }
  const body = await readBody(response, limits.cap, limits.signal)
  if (body === undefined) {
    throw new HttpFailure("too-large", {
      method: sent.method,
      target: sent.target,
      status: response.status,
      limit: limits.cap,
      mayHaveApplied: sent.intent !== "read",
    })
  }
  const answer: HttpAnswer = {
    status: response.status,
    statusText: statusTextOf(response.status, response.statusText),
    contentType: response.headers.get("Content-Type") ?? "",
    headers: Object.fromEntries(response.headers),
    body,
  }
  return answer.status >= 400 ? maskedAnswer(answer, sent.forms) : answer
}
