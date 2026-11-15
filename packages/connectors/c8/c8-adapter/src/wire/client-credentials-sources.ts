import type { TokenSource } from "@miragon/pulse-http"
import { clientCredentialsTokens } from "@miragon/pulse-http/oauth"
import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import type { WirePlatform } from "./wire-platform.js"

export type ClientCredentials = Extract<EngineCredentials, { readonly kind: "clientCredentials" }>

export class ClientCredentialsSources {
  private readonly sources = new Map<string, TokenSource>()

  constructor(private readonly platform: WirePlatform) {}

  of(credentials: ClientCredentials): TokenSource {
    const key = ClientCredentialsSources.keyOf(credentials)
    const known = this.sources.get(key)
    if (known !== undefined) {
      return known
    }
    const source = this.created(credentials)
    this.sources.set(key, source)
    return source
  }

  private created(credentials: ClientCredentials): TokenSource {
    const { tokenEndpoint, clientId, clientSecret, audience, scopes } = credentials
    const platform = this.platform
    return clientCredentialsTokens({
      endpoint: { url: tokenEndpoint, clientId, clientSecret, clientAuth: "post" },
      grant: {
        type: "client_credentials",
        ...(audience === undefined ? {} : { audience }),
        ...(scopes === undefined ? {} : { scopes }),
      },
      platform: { fetch: (input, init) => platform.send(input, init), now: () => platform.now() },
    })
  }

  private static keyOf(credentials: ClientCredentials): string {
    const { tokenEndpoint, clientId, clientSecret, audience, scopes } = credentials
    return JSON.stringify([
      tokenEndpoint,
      clientId,
      clientSecret,
      audience ?? null,
      [...(scopes ?? [])].sort(),
    ])
  }
}
