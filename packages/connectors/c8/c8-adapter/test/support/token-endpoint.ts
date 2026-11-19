import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import { C8Adapter } from "../../src/index.js"
import type { ClientCredentials } from "../../src/wire/client-credentials-sources.js"
import { jsonAnswer, REST_URL } from "./fake-camunda-rest.js"

export const TOKEN_URL = "https://login.test/oauth/token"
export const SECRET = "s3cret-of-the-client"
export const CREDENTIALS: ClientCredentials = {
  kind: "clientCredentials",
  tokenEndpoint: TOKEN_URL,
  clientId: "pulse",
  clientSecret: SECRET,
  audience: "orchestration-api",
  scopes: ["read", "more"],
}

export const MINUTE_MS = 60_000

export class LoginService {
  now = 1_000_000

  readonly tokenForms: URLSearchParams[] = []

  readonly apiAuthorizations: (string | null)[] = []

  readonly apiCalls: string[] = []

  answerToken: () => Response | Promise<Response> = () =>
    jsonAnswer({ access_token: `token-${String(this.tokenForms.length)}`, expires_in: 3600 })

  answerApi: () => Response = () => jsonAnswer({ gatewayVersion: "8.10.8" })

  readonly adapter = new C8Adapter(
    (input, init) => this.answered(new Request(input, init)),
    () => this.now,
  )

  read(credentials: EngineCredentials = CREDENTIALS): Promise<unknown> {
    return this.readFrom(REST_URL, credentials)
  }

  readWithin(timeoutMs: number): Promise<unknown> {
    return this.readFrom(REST_URL, CREDENTIALS, timeoutMs)
  }

  readFrom(
    endpoint: string,
    credentials: EngineCredentials = CREDENTIALS,
    timeoutMs?: number,
  ): Promise<unknown> {
    return this.adapter
      .runtime({ endpoint, credentials, ...(timeoutMs === undefined ? {} : { timeoutMs }) })
      .describeEngine()
      .then(
        () => "answered",
        (error: unknown) => error,
      )
  }

  private async answered(request: Request): Promise<Response> {
    if (!request.url.startsWith(TOKEN_URL)) {
      const authorization = request.headers.get("Authorization")
      this.apiCalls.push(`${new URL(request.url).pathname} ${String(authorization)}`)
      this.apiAuthorizations.push(authorization)
      return this.answerApi()
    }
    this.tokenForms.push(new URLSearchParams(await request.text()))
    return this.answerToken()
  }
}
