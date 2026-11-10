import {
  basicCredential,
  createHttp,
  type Credential,
  CredentialError,
  type CredentialProblem,
  type Http,
  MAX_ANSWER_BYTES,
  noCredential,
} from "@miragon/pulse-http"
import { EngineRequestError } from "./engine-request-error.js"

export type EngineCredentials =
  | { readonly kind: "none" }
  | { readonly kind: "basic"; readonly username: string; readonly password: string }

export interface EngineWireOptions {
  readonly url: string
  readonly credentials: EngineCredentials
  readonly writes: boolean
  readonly send: typeof fetch
}

const TIMEOUT_MS = 60_000

const CREDENTIAL_PROBLEMS: Readonly<Record<CredentialProblem, string>> = {
  "user-colon": "The user name holds a colon, which basic authentication cannot send",
  "control-character": "The user name or password holds a control character",
  "token-syntax": "The token cannot be sent",
}

export class EngineWire {
  static of(options: EngineWireOptions): Http | EngineRequestError {
    try {
      const send = options.send
      return createHttp(
        {
          url: options.url,
          credential: EngineWire.credentialOf(options.credentials),
          timeoutMs: TIMEOUT_MS,
          maxAnswerBytes: MAX_ANSWER_BYTES,
          readOnly: !options.writes,
        },
        { fetch: (input, init) => send(input, init), now: () => Date.now() },
      )
    } catch (error: unknown) {
      return EngineWire.unusable(error)
    }
  }

  private static credentialOf(credentials: EngineCredentials): Credential {
    return credentials.kind === "basic"
      ? basicCredential(credentials.username, credentials.password)
      : noCredential
  }

  private static unusable(error: unknown): EngineRequestError {
    if (error instanceof CredentialError) {
      return EngineRequestError.unusable(CREDENTIAL_PROBLEMS[error.problem], { cause: error })
    }
    const reason = error instanceof Error ? error.message : String(error)
    return EngineRequestError.unusable(`The engine URL cannot be used: ${reason}`, {
      cause: error,
    })
  }
}
