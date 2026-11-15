import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import { CamundaClients } from "../../src/index.js"
import { ErrorTranslation } from "../../src/errors/error-translation.js"
import type { CamundaClient } from "../../src/rest/index.js"
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

  answerToken: () => Response = () =>
    jsonAnswer({ access_token: `token-${String(this.tokenForms.length)}`, expires_in: 3600 })

  answerApi: () => Response = () => jsonAnswer({ gatewayVersion: "8.10.8" })

  readonly clients = new CamundaClients(
    (input, init) => this.answered(new Request(input, init)),
    () => this.now,
  )

  clientOf(credentials: EngineCredentials = CREDENTIALS): CamundaClient {
    return this.clients.of({ endpoint: REST_URL, credentials })
  }

  read(credentials: EngineCredentials = CREDENTIALS): Promise<unknown> {
    const client = this.clientOf(credentials)
    return ErrorTranslation.translated(() => client.topology()).then(
      () => "answered",
      (error: unknown) => error,
    )
  }

  private async answered(request: Request): Promise<Response> {
    if (!request.url.startsWith(TOKEN_URL)) {
      this.apiAuthorizations.push(request.headers.get("Authorization"))
      return this.answerApi()
    }
    this.tokenForms.push(new URLSearchParams(await request.text()))
    return this.answerToken()
  }
}
