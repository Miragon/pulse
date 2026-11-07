/**
 * The boot's own former variables, the names it read up to 0.27: the boot refuses each renamed
 * one while it is set and names its replacement (the composition's retired table, next to the
 * modules'), and warns about those that change nothing now.
 */

/** Former variable -> the one that replaces it (values unchanged). */
export const RENAMED_BOOT_ENV_VARS: Readonly<Record<string, string>> = {
  MCP_USE_OAUTH_KEYCLOAK_SERVER_URL: "MCP_OAUTH_KEYCLOAK_SERVER_URL",
  MCP_USE_OAUTH_KEYCLOAK_REALM: "MCP_OAUTH_KEYCLOAK_REALM",
  MCP_USE_OAUTH_AUTH0_DOMAIN: "MCP_OAUTH_AUTH0_DOMAIN",
  MCP_USE_OAUTH_WORKOS_SUBDOMAIN: "MCP_OAUTH_WORKOS_SUBDOMAIN",
  MCP_USE_OAUTH_BETTER_AUTH_URL: "MCP_OAUTH_BETTER_AUTH_URL",
  MCP_USE_OAUTH_CONVEX_AUTH_URL: "MCP_OAUTH_CONVEX_AUTH_URL",
  MCP_USE_OAUTH_DEBUG: "MCP_OAUTH_DEBUG",
  MCP_USE_LOG_LEVEL: "MCP_LOG_LEVEL",
}

interface Ineffective {
  matches: (name: string) => boolean
  /** Why setting it changes nothing. */
  reason: string
}

/** Read up to 0.27 by the former server framework; nothing replaces them. */
const INEFFECTIVE: readonly Ineffective[] = [
  {
    matches: (name) => name === "CSP_URLS" || /^CSP_[A-Z0-9_]+_DOMAINS$/.test(name),
    reason:
      "a view's CSP holds the server's own origin, the served fonts' and what its tool declares",
  },
  {
    matches: (name) => name === "MCP_ASSETS_URL",
    reason: "every view inlines its bundle and loads its fonts from the server's own origin",
  },
  {
    matches: (name) => name === "MCP_USE_ANONYMIZED_TELEMETRY",
    reason: "the server sends no telemetry",
  },
]

export interface IneffectiveEnv {
  /** The set names, which the typo warner leaves to these warnings. */
  names: string[]
  /** One sentence per kind, naming each set variable. */
  warnings: string[]
}

/** A blank value counts: the setting is there and does nothing. */
export function ineffectiveEnv(env: NodeJS.ProcessEnv): IneffectiveEnv {
  const set = Object.keys(env)
    .filter((name) => env[name] !== undefined)
    .sort()
  const names: string[] = []
  const warnings: string[] = []
  for (const { matches, reason } of INEFFECTIVE) {
    const present = set.filter(matches)
    if (present.length === 0) continue
    names.push(...present)
    const one = present.length === 1
    warnings.push(
      `${present.join(", ")} ${one ? "has" : "have"} no effect: ${reason}. Unset ${one ? "it" : "them"}.`,
    )
  }
  return { names, warnings }
}
