import { type CamundaClient, RestCamundaClient } from "@miragon/pulse-c8-core"
import type { EngineConnection } from "@miragon/pulse-runtime-view/ports"
import { CamundaHttp } from "./rest/camunda-http.js"
import { CamundaWire } from "./wire/camunda-wire.js"
import { ClientCredentialsSources } from "./wire/client-credentials-sources.js"
import type { WirePlatform } from "./wire/wire-platform.js"

export class CamundaClients {
  private readonly platform: WirePlatform
  private readonly sources: ClientCredentialsSources

  constructor(send: typeof fetch, now: () => number) {
    this.platform = { send: (input, init) => send(input, init), now }
    this.sources = new ClientCredentialsSources(this.platform)
  }

  of(connection: EngineConnection): CamundaClient {
    return new RestCamundaClient(
      new CamundaHttp(CamundaWire.of(connection, this.sources, this.platform)),
    )
  }
}
