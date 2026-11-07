import { RuntimeError } from "../../../contract/index.js"
import { RetryAfter } from "./retry-after.js"

export interface TokenFailure {
  readonly error: RuntimeError
  readonly holdMs: number
}

const REFUSED_HOLD_MS = 60_000
const RATE_LIMITED_HOLD_MS = 60_000
const UNREACHABLE_HOLD_MS = 5_000
const MAX_CODE_LENGTH = 64
const OUTSIDE_A_CODE = /[^A-Za-z0-9_.-]/g
const TRY_LATER_STATUSES: ReadonlySet<number> = new Set([408, 425])
const CLIENT_CODES: ReadonlySet<string> = new Set(["invalid_client", "unauthorized_client"])
const ENDPOINT_HINT = "The profile's tokenEndpoint must be the URL that issues tokens."
const REQUEST_HINT =
  "Check the audience and the scopes in the profile. Pulse sends them as written."
const GRANT_HINT =
  "Check that the login service lets this client get a token for the audience and the scopes in the profile."

export class TokenFailures {
  private readonly tokenEndpoint: string

  constructor(tokenEndpoint: string) {
    this.tokenEndpoint = TokenFailures.shown(tokenEndpoint)
  }

  unreachable(): TokenFailure {
    return {
      error: new RuntimeError(
        "unreachable",
        `Cannot reach the token endpoint ${this.tokenEndpoint}.`,
      ),
      holdMs: UNREACHABLE_HOLD_MS,
    }
  }

  answered(response: Response, errorField: unknown, now: number): TokenFailure {
    const { status } = response
    if (status === 429) {
      return {
        error: new RuntimeError(
          "engineFailure",
          "The token endpoint limits requests from this address. Pulse tries again later.",
        ),
        holdMs: RetryAfter.waitMs(response.headers, now) ?? RATE_LIMITED_HOLD_MS,
      }
    }
    if (status >= 500 || TRY_LATER_STATUSES.has(status)) {
      return {
        error: new RuntimeError("unreachable", `The token endpoint failed with HTTP ${status}.`),
        holdMs: UNREACHABLE_HOLD_MS,
      }
    }
    return TokenFailures.refused(this.refusalOf(status, errorField))
  }

  tooLarge(maxBytes: number): TokenFailure {
    return TokenFailures.refused(
      new RuntimeError(
        "unexpectedResponse",
        `The token endpoint answered with more than ${maxBytes} bytes.`,
      ),
    )
  }

  withoutToken(): TokenFailure {
    return TokenFailures.refused(
      new RuntimeError("unexpectedResponse", "The token endpoint answered without a token."),
    )
  }

  malformedToken(): TokenFailure {
    return TokenFailures.refused(
      new RuntimeError(
        "unexpectedResponse",
        "The token endpoint answered with a token outside the Bearer token syntax (RFC 6750).",
      ),
    )
  }

  private refusalOf(status: number, errorField: unknown): RuntimeError {
    if (status < 400) {
      return new RuntimeError("misconfigured", "The token endpoint answered with a redirect.", {
        hint: ENDPOINT_HINT,
      })
    }
    if (status === 401) {
      return TokenFailures.refusedClient(TokenFailures.codeOf(errorField) ?? "HTTP 401")
    }
    const code = status === 400 ? TokenFailures.codeOf(errorField) : undefined
    return code === undefined ? this.refusalByStatus(status) : TokenFailures.refusalByCode(code)
  }

  private refusalByStatus(status: number): RuntimeError {
    if (status === 403) {
      return new RuntimeError(
        "forbidden",
        "The token endpoint refused to issue a token for this client (HTTP 403).",
        { hint: GRANT_HINT },
      )
    }
    return new RuntimeError(
      "misconfigured",
      `The token endpoint ${this.tokenEndpoint} answered with HTTP ${status}.`,
      { hint: ENDPOINT_HINT },
    )
  }

  private static refusalByCode(code: string): RuntimeError {
    if (CLIENT_CODES.has(code)) {
      return TokenFailures.refusedClient(code)
    }
    return new RuntimeError("misconfigured", `The token endpoint refused the request (${code}).`, {
      hint: REQUEST_HINT,
    })
  }

  private static refusedClient(reason: string): RuntimeError {
    return new RuntimeError(
      "unauthorized",
      `The token endpoint refused the client ID or secret (${reason}).`,
    )
  }

  private static codeOf(errorField: unknown): string | undefined {
    if (typeof errorField !== "string") {
      return undefined
    }
    const code = errorField.replace(OUTSIDE_A_CODE, "").slice(0, MAX_CODE_LENGTH)
    return code === "" ? undefined : code
  }

  private static refused(error: RuntimeError): TokenFailure {
    return { error, holdMs: REFUSED_HOLD_MS }
  }

  private static shown(url: string): string {
    if (!URL.canParse(url)) {
      return url
    }
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  }
}
