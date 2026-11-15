import type { ProcessCommands, ProcessRuntime } from "@miragon/pulse-engine-core"
import type {
  BpmnDialect,
  CliTarget,
  EngineAdapter,
  EngineCli,
  EngineConnection,
  EngineWebUi,
} from "@miragon/pulse-runtime-view/ports"
import { C7BpmnDialect } from "./c7-bpmn-dialect.js"
import { C7ProcessCommands } from "./c7-process-commands.js"
import { C7ProcessRuntime } from "./c7-process-runtime.js"
import { PulseCli } from "./cli/pulse-cli.js"
import { EngineHttp, RestEngineClient, RestEngineWriter } from "./engine-rest/index.js"
import { CockpitWebUi } from "./web-ui/cockpit-web-ui.js"

export class C7Adapter implements EngineAdapter {
  readonly bpmn: BpmnDialect = new C7BpmnDialect()
  readonly localEndpoint = "http://localhost:8080/engine-rest"

  constructor(private readonly send: typeof fetch = fetch) {}

  runtime(connection: EngineConnection): ProcessRuntime {
    return C7ProcessRuntime.create(new RestEngineClient(this.httpOf(connection, false)))
  }

  commands(connection: EngineConnection): ProcessCommands {
    return new C7ProcessCommands(
      new RestEngineWriter(this.httpOf(connection, true)),
      new RestEngineClient(this.httpOf(connection, false)),
    )
  }

  webUi(webUiUrl: string): EngineWebUi | undefined {
    return CockpitWebUi.at(webUiUrl)
  }

  cli(target: CliTarget): EngineCli {
    return new PulseCli(target)
  }

  private httpOf(connection: EngineConnection, writes: boolean): EngineHttp {
    return new EngineHttp({
      url: connection.endpoint,
      credentials: connection.credentials,
      writes,
      send: this.send,
    })
  }
}
