/**
 * The end of a sign-in at the authorization server (OpenID Connect RP-Initiated Logout 1.0): the
 * browser goes to the end-session endpoint (`ServerMetadata.endSessionEndpoint`), which ends the
 * user's session there and sends the browser on to the post-logout redirect URI the client
 * registered.
 */
import { withQuery } from "./authorize.js"

/** What a logout request names. */
export interface EndSessionRequest {
  readonly clientId: string
  /** Where the server sends the browser afterwards: a URI registered for the client. */
  readonly postLogoutRedirectUri: string
  /** The ID token of the sign-in; without it the server may ask the user to confirm. */
  readonly idTokenHint?: string
  /** Sent back unchanged with the redirect. */
  readonly state?: string
}

/**
 * The logout URL: the endpoint with its own query kept, plus the ID token hint, the client, the
 * post-logout redirect URI and the state, in the specification's order.
 */
export function endSessionUrl(endpoint: string, request: EndSessionRequest): string {
  const params = new URLSearchParams()
  if (request.idTokenHint !== undefined) params.set("id_token_hint", request.idTokenHint)
  params.set("client_id", request.clientId)
  params.set("post_logout_redirect_uri", request.postLogoutRedirectUri)
  if (request.state !== undefined) params.set("state", request.state)
  return withQuery(endpoint, params)
}
