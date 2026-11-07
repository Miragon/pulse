import {
  FailingRuntime,
  RuntimeError,
  type EngineAdapter,
  type EngineConnection,
  type EngineWebUi,
  type ProcessCommands,
  type ProcessRuntime,
} from "@miragon/pulse-runtime-view/contract"
import { FakeEngine, FakeWorld } from "@miragon/pulse-runtime-view/contract/fake"
import { CompositionRoot } from "../src/worker/composition-root.js"

export class FakeAdapter implements EngineAdapter {
  readonly engine = new FakeEngine(FakeWorld.seed().state)
  readonly connections: EngineConnection[] = []
  readonly unreachable = new Set<string>()
  readonly unauthorized = new Set<string>()

  runtime(connection: EngineConnection): ProcessRuntime {
    this.connections.push(connection)
    if (this.unreachable.has(connection.endpoint)) {
      return FailingRuntime.unreachable(connection.endpoint)
    }
    if (this.unauthorized.has(connection.endpoint)) {
      return new FailingRuntime(new RuntimeError("unauthorized", "The engine refused the login"))
    }
    return this.engine
  }

  commands(): ProcessCommands {
    return this.engine
  }

  webUi(webUiUrl: string): EngineWebUi {
    return {
      name: "Cockpit",
      overviewUrl: () => webUiUrl,
      instanceUrl: (instance) => `${webUiUrl}#/process-instance/${instance.id}`,
      definitionUrl: (definition) => `${webUiUrl}#/process-definition/${definition.id}`,
    }
  }

  root(): CompositionRoot {
    return new CompositionRoot({ c7: this })
  }
}
