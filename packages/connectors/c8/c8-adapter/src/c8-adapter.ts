import type { ProcessCommands, ProcessRuntime } from "@miragon/pulse-engine-core"
import type {
  BpmnDialect,
  EngineAdapter,
  EngineCli,
  EngineConnection,
  EngineWebUi,
} from "@miragon/pulse-runtime-view/ports"
import { C8BpmnDialect } from "./c8-bpmn-dialect.js"
import { C8ProcessRuntime } from "./c8-process-runtime.js"
import { CamundaClients } from "./camunda-clients.js"
import { OperateWebUi } from "./web-ui/operate-web-ui.js"

export class C8Adapter implements EngineAdapter {
  readonly bpmn: BpmnDialect = new C8BpmnDialect()
  private readonly clients: CamundaClients

  constructor(send: typeof fetch = fetch, now: () => number = () => Date.now()) {
    this.clients = new CamundaClients(send, now)
  }

  runtime(connection: EngineConnection): ProcessRuntime {
    return C8ProcessRuntime.create(this.clients.of(connection))
  }

  commands(): ProcessCommands | undefined {
    return undefined
  }

  webUi(webUiUrl: string): EngineWebUi | undefined {
    return OperateWebUi.at(webUiUrl)
  }

  cli(): EngineCli | undefined {
    return undefined
  }
}
