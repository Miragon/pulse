import type {
  BpmnDialect,
  EngineAdapter,
  EngineConnection,
  EngineCredentials,
  EngineProfiles,
  EngineSetup,
  EngineWebUi,
  ProcessCommands,
  ProcessRuntime,
} from "../../contract/index.js"
import type { RequestAuth } from "./auth/request-auth.js"
import { StaticAuth } from "./auth/static-auth.js"
import { TokenSources } from "./auth/token-sources.js"
import { C8BpmnDialect } from "./c8-bpmn-dialect.js"
import { C8ProcessRuntime } from "./c8-process-runtime.js"
import { CamundaHttp, RestCamundaClient } from "./rest/index.js"
import { SaasSetup } from "./setup/saas-setup.js"
import { SelfManagedSetup } from "./setup/self-managed-setup.js"
import { OperateWebUi } from "./web-ui/operate-web-ui.js"

export class C8Adapter implements EngineAdapter {
  readonly id = "c8"

  readonly profiles: EngineProfiles = {
    name: "Camunda 8",
    flavors: ["camunda8"],
    withoutFlavor: false,
    credentials: ["basic", "clientCredentials"],
  }

  readonly setups: readonly EngineSetup[] = [new SaasSetup(), new SelfManagedSetup()]
  readonly bpmn: BpmnDialect = new C8BpmnDialect()

  private readonly tokens: TokenSources

  constructor(
    private readonly send: typeof fetch = fetch,
    now: () => number = Date.now,
  ) {
    this.tokens = new TokenSources(send, now)
  }

  runtime(connection: EngineConnection): ProcessRuntime {
    const http = new CamundaHttp({
      url: connection.endpoint,
      auth: this.authOf(connection.credentials),
      send: this.send,
    })
    return C8ProcessRuntime.create(new RestCamundaClient(http))
  }

  commands(): ProcessCommands | undefined {
    return undefined
  }

  webUi(webUiUrl: string): EngineWebUi | undefined {
    return OperateWebUi.at(webUiUrl)
  }

  private authOf(credentials: EngineCredentials): RequestAuth {
    switch (credentials.kind) {
      case "none":
        return StaticAuth.none()
      case "basic":
        return StaticAuth.basic(credentials.username, credentials.password)
      case "clientCredentials":
        return this.tokens.of(credentials)
    }
  }
}
