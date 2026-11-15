import { RuntimeError, type RuntimeFailure } from "@miragon/pulse-engine-core"
import type { TokenAnswerProblem, TokenReason, TokenTrouble } from "../wire/wire-reason.js"

interface Worded {
  readonly failure: RuntimeFailure
  readonly message: string
  readonly hint?: string
}

type Wording = (reason: TokenReason) => Worded

const ENDPOINT_HINT = "The profile's tokenEndpoint must be the URL that issues tokens."
const REQUEST_HINT =
  "Check the audience and the scopes in the profile. Pulse sends them as written."
const GRANT_HINT =
  "Check that the login service lets this client get a token for the audience and the scopes in the profile."
const CLIENT_HINT = "Check the client ID and the secret you entered for this engine."

const ANSWER_PROBLEMS: Readonly<Record<TokenAnswerProblem, string>> = {
  "not-json": "The token endpoint answered without a token.",
  "no-token": "The token endpoint answered without a token.",
  "token-syntax":
    "The token endpoint answered with a token outside the Bearer token syntax (RFC 6750).",
  "token-type": "The token endpoint answered with a token of another type than Bearer.",
}

export class TokenTexts {
  private static readonly WORDING: Readonly<Record<TokenTrouble, Wording>> = {
    client: (reason) => TokenTexts.refusedClient(reason),
    scope: (reason) => TokenTexts.refusedRequest(reason),
    grant: (reason) => TokenTexts.refusedRequest(reason),
    forbidden: () => ({
      failure: "forbidden",
      message: "The token endpoint refused to issue a token for this client (HTTP 403).",
      hint: GRANT_HINT,
    }),
    "rate-limited": () => ({
      failure: "engineFailure",
      message:
        "The token endpoint limits requests from this address. Pulse waits as long as the endpoint asks before it requests another token.",
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
    "too-large": () => ({
      failure: "unexpectedResponse",
      message: "The token endpoint answered with more than 1 MiB.",
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
      ...(hint === undefined ? {} : { hint }),
    })
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
