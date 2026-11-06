import { ClientCredentialsTokens, type ClientCredentials } from "./client-credentials-tokens.js"

export class TokenSources {
  private readonly sources = new Map<string, ClientCredentialsTokens>()

  constructor(
    private readonly send: typeof fetch,
    private readonly now: () => number,
  ) {}

  of(credentials: ClientCredentials): ClientCredentialsTokens {
    const key = JSON.stringify([
      credentials.tokenEndpoint,
      credentials.clientId,
      credentials.clientSecret,
      credentials.audience,
      credentials.scopes,
    ])
    const known = this.sources.get(key)
    if (known !== undefined) {
      return known
    }
    const tokens = new ClientCredentialsTokens(credentials, this.send, this.now)
    this.sources.set(key, tokens)
    return tokens
  }
}
