import type { CamundaTokenProblem, CamundaTokenTrouble } from "@miragon/pulse-c8-core"
import { RuntimeError, type RuntimeFailure } from "@miragon/pulse-engine-core"
import type { TokenReason } from "../wire/wire-reason.js"

interface Worded {
  readonly failure: RuntimeFailure
  readonly message: string
  readonly hint?: string
}

type Wording = (reason: TokenReason) => Worded

const MIB = 1024 * 1024

const ENDPOINT_HINT = "The profile's tokenEndpoint must be the URL that issues tokens."
const REQUEST_HINT =
  "Check the audience and the scopes in the profile. Pulse sends them as written."
const GRANT_HINT =
  "Check that the login service lets this client get a token for the audience and the scopes in the profile."
const CLIENT_HINT = "Check the client ID and the secret you entered for this engine."

const ANSWER_PROBLEMS: Readonly<Record<CamundaTokenProblem, string>> = {
  "not-json": "The token endpoint answered without a token.",
  "no-token": "The token endpoint answered without a token.",
  "token-syntax":
    "The token endpoint answered with a token outside the Bearer token syntax (RFC 6750).",
  "token-type": "The token endpoint answered with a token of another type than Bearer.",
}

export class TokenTexts {
  private static readonly WORDING: Readonly<Record<CamundaTokenTrouble, Wording>> = {
    client: (reason) => TokenTexts.refusedClient(reason),
    scope: (reason) => TokenTexts.refusedRequest(reason),
    grant: (reason) => TokenTexts.refusedRequest(reason),
    forbidden: () => ({
      failure: "forbidden",
      message: "The token endpoint refused to issue a token for this client (HTTP 403).",
      hint: GRANT_HINT,
    }),
    "rate-limited": (reason) => ({
      failure: "engineFailure",
      message: `The token endpoint limits requests from this address. ${TokenTexts.again(reason)}`,
    }),
    unavailable: (reason) => ({
      failure: "unreachable",
      message: `The token endpoint failed with HTTP ${String(reason.status ?? 0)}.`,
    }),
    redirect: () => ({
      failure: "misconfigured",
      message: "The token endpoint answered with a redirect.",
      hint: ENDPOINT_HINT,
    }),
    "too-large": (reason) => ({
      failure: "unexpectedResponse",
      message: TokenTexts.tooLarge(reason.capBytes),
    }),
    unexpected: (reason) => TokenTexts.unexpected(reason),
    unreachable: (reason) => ({
      failure: "unreachable",
      message: `Cannot reach the token endpoint ${reason.endpoint}.`,
    }),
    timeout: (reason) => ({
      failure: "unreachable",
      message: `The token endpoint ${reason.endpoint} did not answer in time.`,
    }),
    expired: () => ({
      failure: "unauthorized",
      message: "The token expired, and the token endpoint gave no new one.",
    }),
  }

  static errorOf(reason: TokenReason): RuntimeError {
    const { failure, message, hint } = TokenTexts.WORDING[reason.trouble](reason)
    return new RuntimeError(failure, message, {
      cause: reason.cause,
      ...(hint === undefined ? {} : { hint: `${hint} ${TokenTexts.again(reason)}` }),
    })
  }

  private static again(reason: TokenReason): string {
    return `Pulse asks the token endpoint again ${TokenTexts.wait(reason.holdMs)} after its last answer.`
  }

  private static wait(holdMs: number): string {
    const seconds = Math.max(1, Math.ceil(holdMs / 1000))
    if (seconds % 60 === 0) {
      return TokenTexts.minutes(seconds / 60)
    }
    if (seconds < 120) {
      return seconds === 1 ? "a second" : `${String(seconds)} seconds`
    }
    return `about ${TokenTexts.minutes(Math.round(seconds / 60))}`
  }

  private static minutes(count: number): string {
    return count === 1 ? "a minute" : `${String(count)} minutes`
  }

  private static tooLarge(bytes: number | undefined): string {
    if (bytes === undefined) {
      return "The token endpoint's answer is larger than Pulse accepts."
    }
    const size = bytes % MIB === 0 ? `${String(bytes / MIB)} MiB` : `${String(bytes)} bytes`
    return `The token endpoint answered with more than ${size}.`
  }

  private static refusedClient(reason: TokenReason): Worded {
    const why = reason.code ?? `HTTP ${String(reason.status ?? 401)}`
    return {
      failure: "unauthorized",
      message: `The token endpoint refused the client ID or secret (${why}).`,
      hint: CLIENT_HINT,
    }
  }

  private static refusedRequest(reason: TokenReason): Worded {
    const why = reason.code ?? `HTTP ${String(reason.status ?? 400)}`
    return {
      failure: "misconfigured",
      message: `The token endpoint refused the request (${why}).`,
      hint: REQUEST_HINT,
    }
  }

  private static unexpected(reason: TokenReason): Worded {
    if (reason.problem !== undefined) {
      return { failure: "unexpectedResponse", message: ANSWER_PROBLEMS[reason.problem] }
    }
    return {
      failure: "misconfigured",
      message: `The token endpoint ${reason.endpoint} answered with HTTP ${String(reason.status ?? 0)}.`,
      hint: ENDPOINT_HINT,
    }
  }
}
