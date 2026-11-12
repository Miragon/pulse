import {
  basicCredential,
  bearerCredential,
  callerToken,
  type Credential,
  CredentialError,
  type CredentialProblem,
  noCredential,
  staticToken,
} from "@miragon/pulse-http"
import type { EngineAuth, EngineAuthType } from "../../engine-provider.js"
import { resolveMcpBearerToken } from "./mcp-auth.js"

export type { CredentialProblem }

type Factory = (auth: EngineAuth) => Credential

/**
 * The credential of each auth type, total over `EngineAuthType`: Basic as UTF-8 (RFC 7617),
 * a fixed bearer token checked now (trimmed, so a secret file's final line break is no
 * problem), or the MCP caller's verified bearer token, read per request and never renewed. An
 * incomplete one sends nothing, as the profiles refuse it before (engine-profiles.ts).
 */
export const CREDENTIALS: Readonly<Record<EngineAuthType, Factory>> = {
  none: () => noCredential,
  basic: ({ username, password }) =>
    username && password ? basicCredential(username, password) : noCredential,
  bearer: ({ token }) => (token ? bearerCredential(staticToken(token)) : noCredential),
  passthrough: () => bearerCredential(callerToken(resolveMcpBearerToken)),
}

/** Why a credential cannot go out, naming where it comes from and never its value. */
const REFUSED: Readonly<Record<CredentialProblem, string>> = {
  "user-colon":
    "its user name holds a colon, which Basic auth (RFC 7617) cannot carry. Check " +
    "auth.username of its profile, or ENGINE_USERNAME",
  "control-character":
    "its user name or password holds a control character (a line break, say), which Basic " +
    "auth (RFC 7617) cannot carry. Check auth.username of its profile and the variable its " +
    "auth.passwordEnv names, or ENGINE_USERNAME and ENGINE_PASSWORD",
  "token-syntax":
    "its bearer token holds a character no bearer token (RFC 6750) carries, a line break " +
    "inside it, say (one at its end is trimmed). Check the variable auth.tokenEnv of its " +
    "profile names, or ENGINE_TOKEN",
}

/**
 * Why the credential of `auth` cannot be sent, or undefined when it can: the profiles are judged
 * at boot with it, so such a profile is refused on its own, never with a value in the reason.
 */
export function credentialProblemOf(auth: EngineAuth): CredentialProblem | undefined {
  try {
    CREDENTIALS[auth.type](auth)
    return undefined
  } catch (error) {
    if (error instanceof CredentialError) return error.problem
    throw error
  }
}

/**
 * The credential `engineId` signs in with, built once at boot. The profiles were judged with
 * `credentialProblemOf` before, so a credential that cannot be sent fails here only for a
 * direct caller: the boot then fails naming the engine and the setting to check, never the value.
 */
export function credentialFor(engineId: string, auth: EngineAuth): Credential {
  try {
    return CREDENTIALS[auth.type](auth)
  } catch (error) {
    if (!(error instanceof CredentialError)) throw error
    // The cause names the problem only, never the value.
    throw new Error(
      `Engine "${engineId}" cannot send its credentials: ${REFUSED[error.problem]}; the value ` +
        "is not shown.",
      { cause: error },
    )
  }
}

/**
 * The sentence a 401 adds to its message: the remedy depends on where the credential came
 * from. Asked when the 401 arrives, so passthrough tells a missing caller token from a rejected
 * one.
 */
export function unauthorizedHint(type: EngineAuthType): () => string {
  switch (type) {
    case "passthrough":
      return () =>
        resolveMcpBearerToken()
          ? "The engine rejected the forwarded bearer token."
          : "The MCP request carried no bearer token to pass through."
    case "none":
      return () => "The engine requires authentication, but none is configured."
    default:
      return () => "The engine rejected the configured credentials."
  }
}
