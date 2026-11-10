/**
 * What an auth provider's credential does, as the provider tests read it: the header it sends
 * with the next request, and whether it renews after a 401.
 */

import type { AuthProvider } from "../../src/auth/types.js"

/** The Authorization header the provider's credential sends with the next request. */
export async function headersOf(provider: AuthProvider): Promise<Readonly<Record<string, string>>> {
  const authorization = await provider.credential.authorization()
  return authorization === undefined ? {} : { Authorization: authorization.header }
}

/**
 * After a 401: whether the credential renewed, so the transport sends once more; undefined for a
 * credential that never renews, which the transport never asks.
 */
export function renewalOf(provider: AuthProvider): Promise<boolean> | undefined {
  const { credential } = provider
  return credential.renewable
    ? credential.rejected({ header: "Bearer rejected", secrets: [] })
    : undefined
}
