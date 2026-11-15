import type { TokenSource } from "@miragon/pulse-http"
import { clientCredentialsTokens } from "@miragon/pulse-http/oauth"
import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import type { WirePlatform } from "./wire-platform.js"

export type ClientCredentials = Extract<EngineCredentials, { readonly kind: "clientCredentials" }>

interface KeptSource {
  readonly settings: string
  readonly source: TokenSource
}

export class ClientCredentialsSources {
  private readonly sources = new Map<string, KeptSource>()

  constructor(private readonly platform: WirePlatform) {}

  of(endpoint: string, credentials: ClientCredentials): TokenSource {
    const client = JSON.stringify([endpoint, credentials.tokenEndpoint, credentials.clientId])
    const settings = ClientCredentialsSources.settingsOf(credentials)
    const kept = this.sources.get(client)
    if (kept?.settings === settings) {
      return kept.source
    }
    const source = this.created(credentials)
    this.sources.set(client, { settings, source })
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

  private static settingsOf(credentials: ClientCredentials): string {
    const { clientSecret, audience, scopes } = credentials
    return JSON.stringify([clientSecret, audience ?? null, [...(scopes ?? [])].sort()])
  }
}
