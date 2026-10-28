/**
 * `MCP_OAUTH` → the OAuth provider a root installs. mcp-use validates the bearer token, the RFC 8707
 * audience (`MCP_URL`) and serves discovery; the server never mints tokens. It is the ONLY
 * caller-identity source, and it raises every module's no-suffix toolset to its standard set.
 * A gateway that terminates auth in front is invisible here: identity arrives only through this OAuth.
 */
import type { OAuthProvider } from "mcp-use/oauth"
import { oauthAuth0Provider } from "mcp-use/oauth/auth0"
import { oauthKeycloakProvider } from "mcp-use/oauth/keycloak"
import { z } from "zod"

export const OAUTH_ENV_VARS = ["MCP_OAUTH"] as const

const keycloakSchema = z.strictObject({
  provider: z.literal("keycloak"),
  serverUrl: z.url(),
  realm: z.string().min(1),
})

const auth0Schema = z.strictObject({
  provider: z.literal("auth0"),
  // Bare hostname: mcp-use builds the issuer from it; a scheme-prefixed value would 401 at first call.
  domain: z
    .string()
    .min(1)
    .refine((d) => !d.includes("://") && !d.includes("/"), {
      message: 'domain must be a bare hostname, e.g. "tenant.eu.auth0.com" (no scheme, no path)',
    }),
})

/** Strict: a key the server does not honor must fail the boot, never be dropped silently. */
const oauthConfigSchema = z.discriminatedUnion("provider", [keycloakSchema, auth0Schema])

export interface OAuthFromEnvOptions {
  env?: NodeJS.ProcessEnv
  label?: string
}

/**
 * Since mcp-use 2.7 `setup(host)` makes `OAuthProvider<TUser>` invariant, so typed providers no
 * longer widen. Sound: every user went through the provider's `mapAuthInfo` and is read structurally.
 */
const withUnknownUser = <TUser>(provider: OAuthProvider<TUser>): OAuthProvider<unknown> =>
  provider as unknown as OAuthProvider<unknown>

/**
 * Unset → `undefined` plus ONE boot warning; invalid JSON, schema violations and stray
 * `MCP_USE_OAUTH_*` throw: a deployment that asked for auth must never come up without it.
 */
export function oauthFromEnv(
  options: OAuthFromEnvOptions = {},
): OAuthProvider<unknown> | undefined {
  const { env = process.env, label = "oauth" } = options
  const raw = env.MCP_OAUTH?.trim()
  if (!raw) {
    console.warn(
      `[${label}] MCP_OAUTH is unset — there is no caller identity: modules without an explicit toolset run read-only, and user settings cannot be saved. Set MCP_OAUTH, or widen with MCP_ACTIVE_MODULES=<module>:<toolset> (anyone who reaches this port gets that surface).`,
    )
    return undefined
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(
      `MCP_OAUTH is not valid JSON. Expected e.g. {"provider":"keycloak","serverUrl":"https://kc.example.com","realm":"my-realm"}`,
    )
  }
  const parsed = oauthConfigSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`MCP_OAUTH is invalid:\n${z.prettifyError(parsed.error)}`)
  }

  // mcp-use's factories silently fall back to MCP_USE_OAUTH_* from `process.env`: fail fast on strays.
  const strays = Object.keys(process.env).filter((k) => k.startsWith("MCP_USE_OAUTH_"))
  if (strays.length > 0) {
    throw new Error(
      `MCP_OAUTH is the single OAuth config surface — unset ${strays.join(", ")} (mcp-use would silently use them as fallbacks for omitted fields).`,
    )
  }

  const config = parsed.data
  switch (config.provider) {
    case "keycloak":
      return withUnknownUser(
        oauthKeycloakProvider({ serverUrl: config.serverUrl, realm: config.realm }),
      )
    case "auth0":
      return withUnknownUser(oauthAuth0Provider({ domain: config.domain }))
  }
}
