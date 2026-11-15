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
import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import { EngineRequestError } from "./engine-request-error.js"

export interface EngineWireOptions {
  readonly url: string
  readonly credentials: EngineCredentials
  readonly writes: boolean
  readonly send: typeof fetch
}

const TIMEOUT_MS = 60_000
const CLIENT_CREDENTIALS =
  "This engine takes no client credentials: sign in to it with basic authentication or none"

const CREDENTIAL_PROBLEMS: Readonly<Record<CredentialProblem, string>> = {
  "user-colon": "The user name holds a colon, which basic authentication cannot send",
  "control-character": "The user name or password holds a control character",
  "token-syntax": "The token cannot be sent",
}

export class EngineWire {
  static of(options: EngineWireOptions): Http | EngineRequestError {
    try {
      const credential = EngineWire.credentialOf(options.credentials)
      if (credential instanceof EngineRequestError) {
        return credential
      }
      const send = options.send
      return createHttp(
        {
          url: options.url,
          credential,
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

  private static credentialOf(credentials: EngineCredentials): Credential | EngineRequestError {
    switch (credentials.kind) {
      case "none":
        return noCredential
      case "basic":
        return basicCredential(credentials.username, credentials.password)
      case "clientCredentials":
        return EngineRequestError.unusable(CLIENT_CREDENTIALS)
    }
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
