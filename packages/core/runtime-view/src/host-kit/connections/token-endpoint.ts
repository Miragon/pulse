import { tokenEndpointUrlProblem, type TokenEndpointUrlProblemCode } from "@miragon/pulse-profile"

type TokenEndpointRead = { readonly url: string } | { readonly refused: string }

export class TokenEndpoint {
  private static readonly EXAMPLE = "https://login.example.com/oauth/token"

  private static readonly RULES: Readonly<Record<TokenEndpointUrlProblemCode, string>> = {
    "url-invalid": `is no URL: use a URL such as ${TokenEndpoint.EXAMPLE}`,
    "url-credentials":
      "must not contain credentials (they are not shown): Pulse sends the client ID and secret itself",
    "url-not-http": "must start with http:// or https://",
    "url-fragment": "must not contain a fragment",
  }

  static read(written: string): TokenEndpointRead {
    const url = written.trim()
    const problem = tokenEndpointUrlProblem(url)
    return problem === undefined
      ? { url }
      : { refused: `auth.tokenEndpoint ${TokenEndpoint.RULES[problem]}.` }
  }
}
