import type { EngineCredentials, RuntimeError } from "../../../contract/index.js"
import { CappedText } from "../rest/capped-text.js"
import type { RequestAuth } from "./request-auth.js"
import { TokenFailures, type TokenFailure } from "./token-failures.js"

export type ClientCredentials = Extract<EngineCredentials, { kind: "clientCredentials" }>

interface Token {
  readonly header: string
  readonly obtainedAt: number
  readonly refreshAt: number
}

interface Hold {
  readonly error: RuntimeError
  readonly since: number
  readonly until: number
}

interface TokenAnswer {
  readonly response: Response
  readonly text: string | undefined
}

type AnswerFields = Readonly<Record<string, unknown>>

const TIMEOUT_MS = 30_000
const MAX_ANSWER_BYTES = 1024 * 1024
const MAX_SKEW_MS = 60_000
const DEFAULT_LIFETIME_S = 300
const FRESH_TOKEN_MS = 30_000
const DIGITS = /^\d+$/
const ANSWER_TEXT = new CappedText(MAX_ANSWER_BYTES)

export class ClientCredentialsTokens implements RequestAuth {
  private token: Token | undefined

  private pending: Promise<Token> | undefined

  private hold: Hold | undefined

  private readonly failures: TokenFailures

  constructor(
    private readonly credentials: ClientCredentials,
    private readonly send: typeof fetch,
    private readonly now: () => number,
  ) {
    this.failures = new TokenFailures(credentials.tokenEndpoint)
  }

  async header(): Promise<string> {
    const now = this.now()
    if (this.token !== undefined && this.token.obtainedAt <= now && now < this.token.refreshAt) {
      return this.token.header
    }
    if (this.hold !== undefined && this.hold.since <= now && now < this.hold.until) {
      throw this.hold.error
    }
    this.pending ??= this.requested().finally(() => {
      this.pending = undefined
    })
    return (await this.pending).header
  }

  rejected(header: string): boolean {
    if (this.token?.header !== header) {
      return true
    }
    const age = this.now() - this.token.obtainedAt
    if (age >= 0 && age < FRESH_TOKEN_MS) {
      return false
    }
    this.token = undefined
    return true
  }

  private async requested(): Promise<Token> {
    const { response, text } = await this.post()
    const fields = ClientCredentialsTokens.fieldsOf(text)
    if (!response.ok) {
      throw this.held(this.failures.answered(response, fields.error, this.now()))
    }
    if (text === undefined) {
      throw this.held(this.failures.tooLarge(MAX_ANSWER_BYTES))
    }
    const token = this.tokenOf(fields)
    this.token = token
    this.hold = undefined
    return token
  }

  private async post(): Promise<TokenAnswer> {
    try {
      const response = await this.send(this.credentials.tokenEndpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: this.form(),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      return { response, text: await ANSWER_TEXT.read(response) }
    } catch {
      throw this.held(this.failures.unreachable())
    }
  }

  private form(): string {
    const { clientId, clientSecret, audience, scopes } = this.credentials
    return new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      ...(audience === undefined ? {} : { audience }),
      ...(scopes === undefined || scopes.length === 0 ? {} : { scope: scopes.join(" ") }),
    }).toString()
  }

  private tokenOf(fields: AnswerFields): Token {
    const accessToken = fields.access_token
    if (typeof accessToken !== "string" || accessToken === "") {
      throw this.held(this.failures.withoutToken())
    }
    const lifetimeMs = ClientCredentialsTokens.lifetimeOf(fields.expires_in) * 1000
    const obtainedAt = this.now()
    return {
      header: `Bearer ${accessToken}`,
      obtainedAt,
      refreshAt: obtainedAt + lifetimeMs - Math.min(MAX_SKEW_MS, lifetimeMs / 10),
    }
  }

  private held(failure: TokenFailure): RuntimeError {
    const since = this.now()
    this.hold = { error: failure.error, since, until: since + failure.holdMs }
    return failure.error
  }

  private static fieldsOf(text: string | undefined): AnswerFields {
    try {
      const answer: unknown = JSON.parse(text ?? "")
      return typeof answer === "object" && answer !== null ? (answer as AnswerFields) : {}
    } catch {
      return {}
    }
  }

  private static lifetimeOf(expiresIn: unknown): number {
    const seconds =
      typeof expiresIn === "string" && DIGITS.test(expiresIn) ? Number(expiresIn) : expiresIn
    return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
      ? seconds
      : DEFAULT_LIFETIME_S
  }
}
