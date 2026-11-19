import {
  basicCredential,
  bearerCredential,
  callerToken,
  type Credential,
  CredentialError,
  type CredentialProblem,
  noCredential,
  type Platform,
  staticToken,
} from "@miragon/pulse-http"
import { clientCredentialsTokens, type TokenLimits } from "@miragon/pulse-http/oauth"
import type { EngineAuth, EngineAuthType } from "../../engine-provider.js"
import { resolveMcpBearerToken } from "./mcp-auth.js"

export type { CredentialProblem }

type Factory = (auth: EngineAuth, platform?: Platform, limits?: TokenLimits) => Credential

/** Where a credential's own requests go (a token endpoint's): the global `fetch` as it is then. */
export const SERVER_PLATFORM: Platform = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
}

/**
 * Tokens of the client credentials grant from the profile's token endpoint, one source per engine
 * built at boot: one request at a time under `limits` (the engine's deadline), a new token before
 * the old one expires, and after a refusal a hold (`clientCredentialsTokens` of
 * @miragon/pulse-http/oauth).
 */
function clientCredentials(
  auth: EngineAuth,
  platform = SERVER_PLATFORM,
  limits?: TokenLimits,
): Credential {
  const { tokenEndpoint, clientId, clientSecret, audience, scopes } = auth
  if (!tokenEndpoint || !clientId || !clientSecret) return noCredential
  const tokens = clientCredentialsTokens({
    endpoint: { url: tokenEndpoint, clientId, clientSecret, clientAuth: "post" },
    grant: {
      type: "client_credentials",
      ...(audience === undefined ? {} : { audience }),
      ...(scopes === undefined ? {} : { scopes }),
    },
    platform,
    ...(limits === undefined ? {} : { limits }),
  })
  return bearerCredential(tokens)
}

/**
 * The credential of each auth type, total over `EngineAuthType`: Basic as UTF-8 (RFC 7617),
 * a fixed bearer token checked now (trimmed, so a secret file's final line break is no
 * problem), the MCP caller's verified bearer token, read per request and never renewed, or a
 * token the client credentials grant renews. An incomplete one sends nothing, as the profiles
 * refuse it before (engine-profiles.ts).
 */
export const CREDENTIALS: Readonly<Record<EngineAuthType, Factory>> = {
  none: () => noCredential,
  basic: ({ username, password }) =>
    username && password ? basicCredential(username, password) : noCredential,
  bearer: ({ token }) => (token ? bearerCredential(staticToken(token)) : noCredential),
  passthrough: () => bearerCredential(callerToken(resolveMcpBearerToken)),
  clientCredentials,
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
 * The credential `engineId` signs in with, built once at boot; a token source sends its own
 * requests over `platform` under `limits`. The profiles were judged with `credentialProblemOf`
 * before, so a credential that cannot be sent fails here only for a direct caller: the boot then
 * fails naming the engine and the setting to check, never the value.
 */
export function credentialFor(
  engineId: string,
  auth: EngineAuth,
  platform: Platform = SERVER_PLATFORM,
  limits?: TokenLimits,
): Credential {
  try {
    return CREDENTIALS[auth.type](auth, platform, limits)
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

const NO_CREDENTIALS_HINT =
  "The engine requires authentication, but none is configured. Set it in the server's " +
  "configuration: auth in the engine's profile (its secret in an ENGINE_SECRET_* variable), or " +
  "ENGINE_AUTH_TYPE with ENGINE_USERNAME and ENGINE_PASSWORD or ENGINE_TOKEN."

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
      return () => NO_CREDENTIALS_HINT
    default:
      return () => "The engine rejected the configured credentials."
  }
}
