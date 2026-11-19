import type { ProcessCommands, ProcessRuntime } from "@miragon/pulse-engine-core"
import type {
  BpmnDialect,
  CliTarget,
  EngineAdapter,
  EngineCli,
  EngineConnection,
  EngineWebUi,
} from "@miragon/pulse-runtime-view/ports"
import { createEnginePort, type EnginePort } from "@miragon/pulse-c7-core"
import { C7Runtime } from "@miragon/pulse-c7-core/runtime"
import { C7BpmnDialect } from "./c7-bpmn-dialect.js"
import { C7ProcessCommands } from "./c7-process-commands.js"
import { PulseCli } from "./cli/pulse-cli.js"
import { EngineHttp, HttpEngineTransport, RestEngineWriter } from "./engine-rest/index.js"
import { ErrorTranslation } from "./errors/error-translation.js"
import { CockpitWebUi } from "./web-ui/cockpit-web-ui.js"

export class C7Adapter implements EngineAdapter {
  readonly bpmn: BpmnDialect = new C7BpmnDialect()
  readonly localEndpoint = "http://localhost:8080/engine-rest"

  constructor(private readonly send: typeof fetch = fetch) {}

  runtime(connection: EngineConnection): ProcessRuntime {
    return C7Runtime.over(this.portOf(connection), {
      failureOf: (error) => ErrorTranslation.runtimeError(error),
    })
  }

  commands(connection: EngineConnection): ProcessCommands {
    return new C7ProcessCommands(
      new RestEngineWriter(this.httpOf(connection, true)),
      this.portOf(connection),
    )
  }

  webUi(webUiUrl: string): EngineWebUi | undefined {
    return CockpitWebUi.at(webUiUrl)
  }

  cli(target: CliTarget): EngineCli {
    return new PulseCli(target)
  }

  private portOf(connection: EngineConnection): EnginePort {
    return createEnginePort(HttpEngineTransport.over(this.httpOf(connection, false)))
  }

  private httpOf(connection: EngineConnection, writes: boolean): EngineHttp {
    return new EngineHttp({
      url: connection.endpoint,
      credentials: connection.credentials,
      writes,
      send: this.send,
      ...(connection.timeoutMs === undefined ? {} : { timeoutMs: connection.timeoutMs }),
    })
  }
}
