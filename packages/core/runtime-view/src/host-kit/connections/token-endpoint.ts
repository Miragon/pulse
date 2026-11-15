const WEB_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"])

type TokenEndpointRead = { readonly url: string } | { readonly refused: string }

export class TokenEndpoint {
  static readonly EXAMPLE = "https://login.example.com/oauth/token"

  static read(written: string): TokenEndpointRead {
    const url = written.trim()
    if (!URL.canParse(url)) {
      return TokenEndpoint.refused(`is no URL: use a URL such as ${TokenEndpoint.EXAMPLE}`)
    }
    const parsed = new URL(url)
    if (parsed.username !== "" || parsed.password !== "") {
      return TokenEndpoint.refused(
        "must not contain credentials (they are not shown): Pulse sends the client ID and secret itself",
      )
    }
    if (!WEB_PROTOCOLS.has(parsed.protocol)) {
      return TokenEndpoint.refused("must start with http:// or https://")
    }
    if (parsed.hash !== "" || url.endsWith("#")) {
      return TokenEndpoint.refused("must not contain a fragment")
    }
    return { url }
  }

  private static refused(rule: string): TokenEndpointRead {
    return { refused: `auth.tokenEndpoint ${rule}.` }
  }
}
