/**
 * What the model reads when a read of a Camunda 8 cluster fails: the `wordsOf` of c8-core's
 * `C8Runtime` over the server's Camunda 8 wire (c8-connection.ts), on a path of its own beside
 * engine-error.ts. c8-core decides each failure's kind and adds what holds for every surface (the
 * REST root that ends in /v2 to a 404 that names no missing resource, the words of a cluster
 * without secondary storage); these are the server's words, the engine by its id. They carry no
 * hint of the Camunda 7 REST API (no /engine-rest root, none of the variables ENGINE_AUTH_TYPE,
 * ENGINE_USERNAME or ENGINE_PASSWORD, which a camunda8 profile does not read), and the token
 * endpoint's failures name the profile's keys and the ENGINE_SECRET_* family, never the
 * variable itself, the token endpoint's URL or the cluster's url: a redirect to the cluster's or
 * the token endpoint's host says whose host it is, never where, and a cluster's text reaches them
 * with the profile's URLs masked (c8-connection.ts). A failure that says nothing of the dialect
 * (no answer, the deadline, the caller, the size cap) reads as on Camunda 7: the sentence
 * engine-error.ts gives it (`transportSentence`).
 */

import {
  type C8Words,
  type C8WordsOf,
  type CamundaAnsweredFailure,
  type CamundaTokenFailure,
  type CamundaTokenProblem,
  type CamundaTokenTrouble,
  type CamundaTransportFailure,
  UnexpectedAnswerError,
} from "@miragon/pulse-c8-core"
import { HttpFailure } from "@miragon/pulse-http"
import {
  type C8AuthType,
  type C8Connection,
  type RedirectTarget,
  UnusableTokenEndpointError,
} from "./c8-connection.js"
import { transportSentence } from "./engine-error.js"

/**
 * What c8-errors.ts reads of a connection: its engine, its sign-in, the fields of a failure and
 * where a redirect points.
 */
export type C8Wording = Pick<C8Connection, "engineId" | "authType" | "failure" | "redirectTarget">

const MIB = 1024 * 1024

/** The sentence a cluster's 401 adds, by how the server signs in to it. */
const UNAUTHORIZED_HINTS: Readonly<Record<C8AuthType, string>> = {
  none:
    "The cluster requires authentication, but none is configured: set auth in the engine's " +
    "profile, its secret in an ENGINE_SECRET_* variable.",
  basic: "The cluster rejected the configured credentials.",
  clientCredentials:
    "The cluster refused the client's token. Check that the client may read the cluster and " +
    "that auth.audience in the engine's profile names the audience the cluster expects. A " +
    "changed client ID or secret goes into auth.clientId or the ENGINE_SECRET_* variable " +
    "auth.clientSecretEnv names; the server reads both at its start.",
}

const REDIRECT_HINT =
  "Redirects are never followed: the profile's url must be the REST root of the cluster itself, " +
  "which ends in /v2 (https:// when the cluster redirects from http://). A redirect to a login " +
  "page means the credentials are missing or expired."

const CLIENT_HINT =
  "Check auth.clientId in the engine's profile and the secret in the ENGINE_SECRET_* variable " +
  "its auth.clientSecretEnv names; the server reads both at its start."
const REQUEST_HINT =
  "Check auth.audience and auth.scopes in the engine's profile: they are sent as written."
const GRANT_HINT =
  "Check that the token endpoint lets this client get a token for the audience and the scopes " +
  "in the engine's profile."
const ENDPOINT_HINT =
  "auth.tokenEndpoint in the engine's profile must be the URL that issues tokens."

/** What is wrong with a token endpoint's 200, after "the token endpoint of engine x". */
const ANSWER_PROBLEMS: Readonly<Record<CamundaTokenProblem, string>> = {
  "not-json": "answered without a token",
  "no-token": "answered without a token",
  "token-syntax": "answered with a token outside the Bearer token syntax (RFC 6750)",
  "token-type": "answered with a token of another type than Bearer",
}

/** The wait a hold asks for, in words. */
function waitOf(holdMs: number): string {
  const seconds = Math.max(1, Math.ceil(holdMs / 1000))
  const minutes = (count: number) => (count === 1 ? "a minute" : `${String(count)} minutes`)
  if (seconds % 60 === 0) return minutes(seconds / 60)
  if (seconds < 120) return seconds === 1 ? "a second" : `${String(seconds)} seconds`
  return `about ${minutes(Math.round(seconds / 60))}`
}

/** The size cap a token endpoint's answer went over, in words. */
function sizeOf(bytes: number | undefined): string {
  if (bytes === undefined) return "more than the server accepts"
  return bytes % MIB === 0
    ? `more than ${String(bytes / MIB)} MiB`
    : `more than ${String(bytes)} bytes`
}

/** Why the token endpoint refused: its error code, else the status. */
const whyOf = (failure: CamundaTokenFailure, status: number): string =>
  failure.code ?? `HTTP ${String(failure.status ?? status)}`

type TokenWording = (failure: CamundaTokenFailure, engine: string) => C8Words

const refusedRequest: TokenWording = (failure, engine) => ({
  message: `the token endpoint refused the token request of ${engine} (${whyOf(failure, 400)})`,
  hint: REQUEST_HINT,
})

/** Each trouble of the token endpoint in the model's words, total over its kinds. */
const TOKEN_WORDS: Readonly<Record<CamundaTokenTrouble, TokenWording>> = {
  client: (failure, engine) => ({
    message: `the token endpoint refused the client of ${engine} (${whyOf(failure, 401)})`,
    hint: CLIENT_HINT,
  }),
  scope: refusedRequest,
  grant: refusedRequest,
  forbidden: (_, engine) => ({
    message: `the token endpoint refused to issue a token to the client of ${engine} (HTTP 403)`,
    hint: GRANT_HINT,
  }),
  "rate-limited": (_, engine) => ({
    message: `the token endpoint limits the token requests of ${engine} (HTTP 429)`,
  }),
  unavailable: (failure, engine) => ({
    message:
      failure.status === undefined
        ? `the token endpoint of ${engine} cannot answer now`
        : `the token endpoint of ${engine} failed with HTTP ${String(failure.status)}`,
  }),
  redirect: (_, engine) => ({
    message: `the token endpoint of ${engine} answered with a redirect`,
    hint: ENDPOINT_HINT,
  }),
  "too-large": (failure, engine) => ({
    message: `the token endpoint of ${engine} answered with ${sizeOf(failure.capBytes)}`,
  }),
  unexpected: (failure, engine) =>
    failure.problem === undefined
      ? {
          message: `the token endpoint of ${engine} answered with HTTP ${String(failure.status ?? 0)}`,
          hint: ENDPOINT_HINT,
        }
      : { message: `the token endpoint of ${engine} ${ANSWER_PROBLEMS[failure.problem]}` },
  unreachable: (_, engine) => ({ message: `the token endpoint of ${engine} cannot be reached` }),
  timeout: (_, engine) => ({ message: `the token endpoint of ${engine} did not answer in time` }),
  expired: (_, engine) => ({
    message: `the token of ${engine} expired, and the token endpoint gave no new one`,
  }),
}

/** The token endpoint's failure, with when the server asks it again. */
function tokenWords(failure: CamundaTokenFailure, engine: string): C8Words {
  const { message, hint } = TOKEN_WORDS[failure.trouble](failure, engine)
  const again = `The server asks the token endpoint again ${waitOf(failure.holdMs)} after its last answer.`
  return { message, hint: hint === undefined ? again : `${hint} ${again}` }
}

/**
 * Where a redirect pointed: the cluster's and the token endpoint's host by name, never by their
 * URLs; another host's target (origin and path) as the connection masked it.
 */
function whereTo(target: RedirectTarget | undefined): string {
  switch (target?.host) {
    case undefined:
      return "redirect"
    case "cluster":
      return target.scheme === undefined
        ? "redirect to the cluster's own host"
        : `redirect to the cluster's host over ${target.scheme}`
    case "tokenEndpoint":
      return "redirect to the token endpoint's host"
    case "other":
      return `redirect to ${target.location}`
  }
}

/** A redirect: where it pointed, said by the profile's URLs, and the /v2 root. */
function redirectWords(
  error: unknown,
  failure: CamundaAnsweredFailure,
  { redirectTarget }: C8Wording,
  engine: string,
): C8Words {
  const where = whereTo(redirectTarget(error))
  return { message: `[${String(failure.status)}] ${where} (${engine})`, hint: REDIRECT_HINT }
}

/** An error answer: its status, its problem's title and what it states. */
function answeredWords(
  error: unknown,
  failure: CamundaAnsweredFailure,
  wording: C8Wording,
  engine: string,
): C8Words {
  if (failure.redirect) return redirectWords(error, failure, wording, engine)
  const head =
    failure.title === undefined
      ? String(failure.status)
      : `${String(failure.status)} ${failure.title}`
  const message = `[${head}] ${failure.detail ?? "empty response body"} (${engine})`
  return failure.status === 401
    ? { message, hint: UNAUTHORIZED_HINTS[wording.authType] }
    : { message }
}

/** A request that got no answer or was refused before sending. */
function transportWords(
  error: unknown,
  failure: CamundaTransportFailure,
  engineId: string,
): C8Words {
  const sentence = error instanceof HttpFailure ? transportSentence(error, engineId) : undefined
  if (sentence !== undefined) return { message: sentence }
  if (error instanceof UnusableTokenEndpointError) {
    return {
      message: `the token endpoint of engine ${engineId} cannot be used (${error.message}); nothing was sent`,
      hint: ENDPOINT_HINT,
    }
  }
  const code = failure.code === undefined ? "" : ` (${failure.code})`
  return { message: `the credentials cannot be sent${code}; nothing was sent (engine ${engineId})` }
}

/** An error this wire did not raise: an answer c8-core cannot read, or anything else. */
function unreadWords(error: unknown, engine: string): C8Words {
  if (error instanceof UnexpectedAnswerError) {
    return { message: `the answer of ${engine} is not what the server reads: ${error.message}` }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { message: `${message} (${engine})` }
}

/**
 * The `wordsOf` of `C8Runtime.over(transport, { wordsOf })` for the engine of `connection`: every
 * failure of its wire in the model's words, read from the fields the wire copied (masked).
 */
export function c8WordsOf(connection: C8Wording): C8WordsOf {
  const engine = `engine ${connection.engineId}`
  return (error) => {
    const failure = connection.failure(error)
    switch (failure?.kind) {
      case "answered":
        return answeredWords(error, failure, connection, engine)
      case "token":
        return tokenWords(failure, engine)
      case "transport":
        return transportWords(error, failure, connection.engineId)
      default:
        return unreadWords(error, engine)
    }
  }
}
