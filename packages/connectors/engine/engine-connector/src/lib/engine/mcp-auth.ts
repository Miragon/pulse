import { getMcpRequestInfo } from "@miragon/pulse-widget-shell/server"

/**
 * Token provider for `authType: "passthrough"`: trusted single-audience setups only, since
 * the engine could replay the token against this server. Reads the ambient request info
 * because this runs inside a hey-api call with no handler `ctx`. Without a token the engine
 * answers 401, which presumes REST auth is on: a default engine ignores the token.
 * A handler suspending across requests (`ctx.elicit`/`ctx.sample`) would resume under the ORIGINAL token.
 */
export function resolveMcpBearerToken(): string | undefined {
  const header = getMcpRequestInfo()?.authorization
  if (!header) return undefined
  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim())
  return match ? match[1] : undefined
}
