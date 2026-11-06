import type {
  EngineAdapter,
  EngineConnection,
  EngineProfiles,
  EngineSetup,
  EngineWebUi,
  ProcessCommands,
  ProcessRuntime,
} from "../../contract/index.js"
import { C7ProcessCommands } from "./c7-process-commands.js"
import { C7ProcessRuntime } from "./c7-process-runtime.js"
import { EngineHttp, RestEngineClient, RestEngineWriter } from "./engine-rest/index.js"
import { CockpitWebUi } from "./web-ui/cockpit-web-ui.js"

export class C7Adapter implements EngineAdapter {
  readonly id = "c7"

  readonly profiles: EngineProfiles = {
    name: "Camunda 7, Operaton or CIB seven",
    flavors: ["camunda7", "cibseven", "operaton"],
    withoutFlavor: true,
    credentials: ["basic"],
    localEndpoint: "http://localhost:8080/engine-rest",
  }

  readonly setups: readonly EngineSetup[] = []

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

  private httpOf(connection: EngineConnection, writes: boolean): EngineHttp {
    return new EngineHttp({
      url: connection.endpoint,
      credentials: connection.credentials,
      writes,
      send: this.send,
    })
  }
}
