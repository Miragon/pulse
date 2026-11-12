/**
 * HTTP Basic authentication (RFC 7617, UTF-8): the credential of @miragon/pulse-http, which masks
 * the password and the Basic value in what the engine sends back. The header needs no network
 * access, so dry-run previews show it (masked unless --show-secrets).
 */

import { basicCredential, type Credential } from "@miragon/pulse-http"
import type { BasicAuthConfig } from "../config/types.js"
import type { AuthPreview, AuthProvider } from "./types.js"

/** `env`, or `profile for the user, env for the password` when the two differ. */
export function credentialSource(sources: BasicAuthConfig["sources"]): string {
  return sources.username === sources.password
    ? sources.username
    : `${sources.username} for the user, ${sources.password} for the password`
}

/** The headers a credential sends, known without network access (Basic). */
export async function credentialHeaders(credential: Credential): Promise<AuthPreview> {
  const authorization = await credential.authorization()
  return { headers: authorization === undefined ? {} : { Authorization: authorization.header } }
}

/**
 * The provider of Basic auth. Config resolution has refused a username with ":" and control
 * characters in either value already (src/config/auth.ts), the cases the credential refuses.
 */
export function basicAuth(config: BasicAuthConfig): AuthProvider {
  const credential = basicCredential(config.username, config.password)
  return {
    type: "basic",
    credential,
    preview: () => credentialHeaders(credential),
    principal: { user: config.username, source: credentialSource(config.sources) },
  }
}
