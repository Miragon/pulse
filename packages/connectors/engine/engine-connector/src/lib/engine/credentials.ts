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

type Factory = (auth: EngineAuth) => Credential

/**
 * The credential of each auth type, total over `EngineAuthType`: Basic as UTF-8 (RFC 7617),
 * a fixed bearer token checked now (trimmed, so a secret file's final line break is no
 * problem), or the MCP caller's verified bearer token, read per request and never renewed. An
 * incomplete one sends nothing, as the config schema refuses it before.
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
    "ENGINE_USERNAME, or the username in the auth of its entry",
  "control-character":
    "its user name or password holds a control character (a line break, say), which Basic " +
    "auth (RFC 7617) cannot carry. Check ENGINE_USERNAME and ENGINE_PASSWORD, or the auth of " +
    "its entry",
  "token-syntax":
    "its bearer token holds a character no bearer token (RFC 6750) carries, a line break " +
    "inside it, say (one at its end is trimmed). Check ENGINE_TOKEN, or the token in the auth " +
    "of its entry",
}

/**
 * The credential `engineId` signs in with: built once, at boot, so a credential that cannot be
 * sent fails the boot naming the engine and the setting to check, never the value.
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
