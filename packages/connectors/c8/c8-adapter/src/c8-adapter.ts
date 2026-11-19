import { C8Runtime, type C8RuntimeOptions } from "@miragon/pulse-c8-core"
import type { ProcessCommands, ProcessRuntime } from "@miragon/pulse-engine-core"
import type {
  BpmnDialect,
  EngineAdapter,
  EngineCli,
  EngineConnection,
  EngineWebUi,
} from "@miragon/pulse-runtime-view/ports"
import { C8BpmnDialect } from "./c8-bpmn-dialect.js"
import { CamundaTransports } from "./camunda-transports.js"
import { ErrorTranslation } from "./errors/error-translation.js"
import { OperateWebUi } from "./web-ui/operate-web-ui.js"

export class C8Adapter implements EngineAdapter {
  readonly bpmn: BpmnDialect = new C8BpmnDialect()
  private readonly transports: CamundaTransports
  private readonly options: C8RuntimeOptions = {
    wordsOf: (error) => ErrorTranslation.wordsOf(error),
  }

  constructor(send: typeof fetch = fetch, now: () => number = () => Date.now()) {
    this.transports = new CamundaTransports(send, now)
  }

  runtime(connection: EngineConnection): ProcessRuntime {
    return C8Runtime.over(this.transports.of(connection), this.options)
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
