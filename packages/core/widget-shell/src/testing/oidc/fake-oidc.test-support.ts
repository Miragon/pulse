/**
 * A client of the fake provider as the web sign-in will be one: `@miragon/pulse-http/oauth`'s
 * discovery, PKCE, authorization URL, callback check and token requests over the real `fetch`.
 */
import {
  authorizationUrl,
  callbackResult,
  createPkce,
  discover,
  requestToken,
  serverMetadata,
  type ServerMetadata,
  type TokenEndpoint,
  type TokenRecord,
} from "@miragon/pulse-http/oauth"
import { FAKE_OIDC_CLIENT } from "./realm.js"
import type { FakeOidc } from "./fake-oidc.js"

/**
 * The limit of a test of the fake provider's flows: the provider makes its RS256 keys, signs its
 * tokens and answers over real requests, a server booted beside it or not, 0.1 to 0.3 s alone and
 * up to 3.4 s on the CI runner, where `pnpm test` runs every package's suite at once on four cores.
 */
export const FAKE_PROVIDER = { timeout: 15_000 }

export const REDIRECT_URI = "https://pulse.example.test/app/auth/callback"
export const RESOURCE = "https://pulse.example.test/mcp"
export const platform = { fetch: globalThis.fetch, now: () => Date.now() }

const isLoopback = (host: string) => host === "127.0.0.1"

/**
 * The provider's metadata as a confidential client reads it (of `issuer`, an Entra ID tenant's
 * other authority, where named), or a failed test.
 */
export async function metadataOf(fake: FakeOidc, issuer = fake.issuer): Promise<ServerMetadata> {
  const answers = await discover(issuer, platform)
  const document = answers.at(-1)?.json
  if (document === undefined) throw new Error("no discovery document")
  const metadata = serverMetadata(document, issuer, { confidential: true, isLoopback })
  if (!("authorizationEndpoint" in metadata)) throw new Error(`unusable: ${metadata.problem}`)
  return metadata
}

export const tokenEndpointOf = (
  metadata: ServerMetadata,
  client: { readonly id: string; readonly secret?: string } = FAKE_OIDC_CLIENT,
  clientAuth: "basic" | "post" = metadata.clientAuth,
): TokenEndpoint => ({
  url: metadata.tokenEndpoint,
  clientId: client.id,
  ...(client.secret === undefined ? {} : { clientSecret: client.secret }),
  clientAuth,
})

/** An authorization request of the web client with PKCE, its state and verifier beside it. */
export async function startSignIn(metadata: ServerMetadata, scopes = ["openid", "profile"]) {
  const pkce = await createPkce()
  const url = authorizationUrl(metadata.authorizationEndpoint, {
    clientId: FAKE_OIDC_CLIENT.id,
    redirectUri: REDIRECT_URI,
    scopes,
    resources: [RESOURCE],
    challenge: pkce.challenge,
    state: pkce.state,
  })
  return { url, pkce }
}

/** A whole sign-in as `username`: the callback checked, the code exchanged. */
export async function signIn(
  fake: FakeOidc,
  username?: string,
  scopes?: string[],
): Promise<TokenRecord> {
  const metadata = await metadataOf(fake)
  const { url, pkce } = await startSignIn(metadata, scopes)
  const callback = new URL(await fake.signIn(url, username))
  const result = callbackResult(callback.searchParams, {
    state: pkce.state,
    issuer: fake.issuer,
    issRequired: metadata.issParameterRequired,
  })
  if (!("code" in result)) throw new Error(`no code: ${result.problem}`)
  return requestToken(
    tokenEndpointOf(metadata),
    {
      type: "authorization_code",
      code: result.code,
      redirectUri: REDIRECT_URI,
      verifier: pkce.verifier,
      resources: [RESOURCE],
    },
    platform,
  )
}

/** What an Entra ID sign-in asks: its scopes, the authority it goes through and its client. */
interface EntraSignIn {
  readonly scopes: readonly string[]
  /** Default: the tenant's v2.0 authority, the fake's issuer. */
  readonly issuer?: string
  /** Default: {@link FAKE_OIDC_CLIENT}. */
  readonly client?: { readonly id: string; readonly secret?: string }
}

/**
 * A whole sign-in at an Entra ID tenant as Entra ID asks it: no resource, the scopes at the
 * authorization request and the code exchange alike.
 */
export async function entraSignIn(fake: FakeOidc, request: EntraSignIn): Promise<TokenRecord> {
  const { scopes, issuer = fake.issuer, client = FAKE_OIDC_CLIENT } = request
  const metadata = await metadataOf(fake, issuer)
  const pkce = await createPkce()
  const url = authorizationUrl(metadata.authorizationEndpoint, {
    clientId: client.id,
    redirectUri: REDIRECT_URI,
    scopes,
    challenge: pkce.challenge,
    state: pkce.state,
  })
  const callback = new URL(await fake.signIn(url))
  const expected = { state: pkce.state, issuer, issRequired: metadata.issParameterRequired }
  const result = callbackResult(callback.searchParams, expected)
  if (!("code" in result)) throw new Error(`no code: ${result.problem}`)
  return requestToken(
    tokenEndpointOf(metadata, client),
    {
      type: "authorization_code",
      code: result.code,
      redirectUri: REDIRECT_URI,
      verifier: pkce.verifier,
      scopes,
    },
    platform,
  )
}
