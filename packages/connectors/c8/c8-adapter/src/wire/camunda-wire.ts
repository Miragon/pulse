import {
  createHttp,
  CredentialError,
  type CredentialProblem,
  decodeText,
  type Http,
  type HttpAnswer,
  HttpFailure,
  type Intent,
  joinUrl,
  MAX_ANSWER_BYTES,
} from "@miragon/pulse-http"
import { TokenFailure } from "@miragon/pulse-http/oauth"
import type { EngineConnection } from "@miragon/pulse-runtime-view/ports"
import { AnswerReasons } from "./answer-reasons.js"
import type { ClientCredentialsSources } from "./client-credentials-sources.js"
import { HttpReasons } from "./http-reasons.js"
import { SecretMask } from "./secret-mask.js"
import { TokenReasons } from "./token-reasons.js"
import { WireCredentials } from "./wire-credentials.js"
import type { WirePlatform } from "./wire-platform.js"
import type { AnsweredReason, WireReason } from "./wire-reason.js"

export interface WireRequest {
  readonly method: "GET" | "POST"
  readonly path: string
  readonly accept: string
  readonly intent: Intent
  readonly body?: string
}

export type WireOutcome = { readonly text: string } | { readonly reason: WireReason }

const TIMEOUT_MS = 60_000

const REFUSED_TOKEN_HINT =
  "The cluster refused this client's token. Check that the client has the rights to read the cluster and that the profile names the audience the cluster expects. If the client ID or secret changed, enter them again with Set credentials."

const NO_LOGIN_HINT =
  "The cluster asks for a login, and Pulse sent none. Add one with Set credentials."

const CREDENTIAL_PROBLEMS: Readonly<Record<CredentialProblem, string>> = {
  "user-colon": "The user name holds a colon, which basic authentication cannot send",
  "control-character": "The user name or password holds a control character",
  "token-syntax": "The token cannot be sent",
}

export class CamundaWire {
  private constructor(
    private readonly http: Http | WireReason,
    private readonly tokenEndpoint: string | undefined,
    private readonly mask: SecretMask,
    private readonly loginSent: boolean,
  ) {}

  static of(
    connection: EngineConnection,
    sources: ClientCredentialsSources,
    platform: WirePlatform,
  ): CamundaWire {
    const tokenEndpoint = WireCredentials.tokenEndpointOf(connection.credentials)
    const http = CamundaWire.httpOf(connection, sources, platform)
    const mask = SecretMask.of(connection.credentials)
    return new CamundaWire(http, tokenEndpoint, mask, connection.credentials.kind !== "none")
  }

  async exchange(request: WireRequest): Promise<WireOutcome> {
    const http = this.http
    if (!("send" in http)) {
      return { reason: http }
    }
    try {
      const answer = await http.send({
        method: request.method,
        url: joinUrl(http.root, request.path),
        intent: request.intent,
        headers: CamundaWire.headersOf(request),
        ...(request.body === undefined ? {} : { body: request.body }),
      })
      return answer.status >= 400
        ? { reason: this.mask.reason(this.answered(answer)) }
        : { text: decodeText(answer) }
    } catch (error: unknown) {
      return { reason: this.mask.reason(this.reasonOf(error)) }
    }
  }

  private answered(answer: HttpAnswer): AnsweredReason {
    const reason = AnswerReasons.of(answer, undefined, this.mask)
    if (answer.status !== 401) {
      return reason
    }
    if (this.tokenEndpoint !== undefined) {
      return { ...reason, hint: REFUSED_TOKEN_HINT }
    }
    return this.loginSent
      ? reason
      : {
          ...reason,
          message: AnswerReasons.statusLine(401, answer.statusText),
          hint: NO_LOGIN_HINT,
        }
  }

  private reasonOf(error: unknown): WireReason {
    if (error instanceof HttpFailure) {
      return HttpReasons.of(error, this.mask)
    }
    if (error instanceof TokenFailure) {
      return TokenReasons.of(error, this.tokenEndpoint ?? "")
    }
    if (error instanceof RangeError) {
      const message = `The token endpoint URL cannot be used: ${error.message}`
      return { kind: "unread", message, hint: undefined, cause: error }
    }
    throw error
  }

  private static httpOf(
    connection: EngineConnection,
    sources: ClientCredentialsSources,
    platform: WirePlatform,
  ): Http | WireReason {
    try {
      return createHttp(
        {
          url: connection.endpoint,
          credential: WireCredentials.of(connection, sources),
          timeoutMs: TIMEOUT_MS,
          maxAnswerBytes: MAX_ANSWER_BYTES,
          readOnly: true,
        },
        { fetch: (input, init) => platform.send(input, init), now: () => platform.now() },
      )
    } catch (error: unknown) {
      return CamundaWire.unusable(error)
    }
  }

  private static unusable(error: unknown): WireReason {
    if (error instanceof CredentialError) {
      const message = CREDENTIAL_PROBLEMS[error.problem]
      return { kind: "unread", message, hint: undefined, cause: error }
    }
    const reason = error instanceof Error ? error.message : String(error)
    const message = `The cluster URL cannot be used: ${reason}`
    return { kind: "unread", message, hint: undefined, cause: error }
  }

  private static headersOf(request: WireRequest): Record<string, string> {
    return {
      Accept: request.accept,
      ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
    }
  }
}
