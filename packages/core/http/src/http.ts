/**
 * The transport: a connection made into an `Http` over the `fetch` the platform hands in.
 */
import {
  attempt,
  type Attempted,
  type Context,
  type Prepared,
  secretValues,
  sentOf,
  sentWith,
} from "./attempt.js"
import { MAX_ANSWER_BYTES } from "./body.js"
import { type Authorization, type Credential, CredentialError } from "./credential.js"
import { HttpFailure } from "./failure.js"
import { fetchOf } from "./fetch-adapter.js"
import { type IntegerMode, parseJson } from "./json.js"
import { decodeText, problemOf } from "./problem.js"
import type { Connection, Http, HttpAnswer, HttpRequest, Platform } from "./types.js"
import { requestUrlProblem, rootOf } from "./url.js"

/** The longest delay a timer holds; a longer one fires at once. */
const MAX_TIMEOUT_MS = 2_147_483_647

/** Headers that always carry a secret. */
export const SECRET_HEADERS: readonly string[] = ["authorization", "proxy-authorization", "cookie"]

/** An HTTP method token (RFC 9110). */
const METHOD = /^[!#$%&'*+.^_`|~\dA-Za-z-]+$/

function contextOf(connection: Connection, platform: Platform): Context {
  const { timeoutMs, maxAnswerBytes = MAX_ANSWER_BYTES } = connection
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError(
      `timeoutMs must be a positive integer of at most ${String(MAX_TIMEOUT_MS)}`,
    )
  }
  if (!(maxAnswerBytes > 0) || !(Number.isInteger(maxAnswerBytes) || maxAnswerBytes === Infinity)) {
    throw new RangeError("maxAnswerBytes must be a positive integer or Infinity")
  }
  const named = (connection.secretHeaders ?? []).map((name) => name.toLowerCase())
  return {
    root: rootOf(connection.url),
    credential: connection.credential,
    timeoutMs,
    cap: maxAnswerBytes,
    headers: connection.headers ?? {},
    secretHeaders: new Set([...SECRET_HEADERS, ...named]),
    readOnly: connection.readOnly === true,
    userAgent: connection.userAgent,
    platform,
  }
}

/** The values of the secret headers a request names itself. */
function requestSecrets(context: Context, request: Pick<Prepared, "headers">): string[] {
  return secretValues(context, Object.entries({ ...context.headers, ...request.headers }))
}

/** What of a request cannot be sent, checked before anything else happens. */
function refusal(context: Context, request: HttpRequest): string | undefined {
  if (!METHOD.test(request.method)) return "method"
  const problem = requestUrlProblem(request.url, context.root)
  if (problem !== undefined) return problem
  const bodiless = /^(?:GET|HEAD)$/i.test(request.method)
  return bodiless && request.body !== undefined ? "body" : undefined
}

function prepare(context: Context, request: HttpRequest): Prepared {
  const refused = refusal(context, request)
  const sent = sentOf(request, requestSecrets(context, { headers: request.headers ?? {} }))
  if (refused !== undefined) {
    throw new HttpFailure("invalid-request", { ...sent, code: refused, mayHaveApplied: false })
  }
  if (context.readOnly && request.intent !== "read") {
    throw new HttpFailure("refused-write", { ...sent, mayHaveApplied: false })
  }
  return {
    ...request,
    headers: request.headers ?? {},
    signal: request.intent === "read" ? request.signal : undefined,
  }
}

async function authorize(context: Context, request: Prepared): Promise<Authorization | undefined> {
  try {
    return await context.credential.authorization()
  } catch (error) {
    if (!(error instanceof CredentialError)) throw error
    const sent = sentOf(request, requestSecrets(context, request))
    throw new HttpFailure("credential", { ...sent, code: error.problem, mayHaveApplied: false })
  }
}

/** Whether a 401 earns the one second attempt: only when the credential renewed. */
async function renewed(
  credential: Credential,
  answer: HttpAnswer,
  sent: Authorization | undefined,
): Promise<boolean> {
  if (answer.status !== 401 || sent === undefined || !credential.renewable) return false
  return credential.rejected(sent)
}

interface Exchanged extends Attempted {
  readonly request: Prepared
}

async function exchange(context: Context, request: HttpRequest): Promise<Exchanged> {
  const prepared = prepare(context, request)
  const first = await authorize(context, prepared)
  const tried = await attempt(context, prepared, first)
  if (!(await renewed(context.credential, tried.answer, first))) {
    return { ...tried, request: prepared }
  }
  const again = await attempt(context, prepared, await authorize(context, prepared))
  return { ...again, request: prepared }
}

/** The answer, or a failure for a status from 400 on. */
function checked({ answer, forms, request }: Exchanged): HttpAnswer {
  if (answer.status < 400) return answer
  const reason = answer.status === 401 ? "unauthorized" : "status"
  throw new HttpFailure(reason, {
    ...sentWith(request, forms),
    status: answer.status,
    problem: problemOf(answer),
    answer,
    mayHaveApplied: false,
  })
}

function jsonOf(exchanged: Exchanged, integers: IntegerMode): unknown {
  const answer = checked(exchanged)
  if (answer.body.byteLength === 0) return undefined
  try {
    return parseJson(decodeText(answer), integers)
  } catch {
    throw new HttpFailure("invalid-answer", {
      ...sentWith(exchanged.request, exchanged.forms),
      status: answer.status,
      mayHaveApplied: exchanged.request.intent !== "read",
    })
  }
}

/**
 * A transport for `connection` over `platform.fetch`. Throws a RangeError for a URL, a timeout
 * or a cap it cannot use, naming no value.
 */
export function createHttp(connection: Connection, platform: Platform): Http {
  const context = contextOf(connection, platform)
  const send = async (request: HttpRequest): Promise<HttpAnswer> =>
    (await exchange(context, request)).answer
  return {
    root: context.root,
    send,
    call: async (request) => checked(await exchange(context, request)),
    json: async (request, integers = "number") =>
      jsonOf(await exchange(context, request), integers),
    asFetch: (options) => fetchOf(send, options),
  }
}
