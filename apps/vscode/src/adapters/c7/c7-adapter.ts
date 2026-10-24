import type {
  EngineAdapter,
  EngineConnection,
  EngineCredentials,
  EngineWebUi,
  ProcessCommands,
  ProcessRuntime,
} from "../../contract/index.js"
import { C7ProcessCommands } from "./c7-process-commands.js"
import { C7ProcessRuntime } from "./c7-process-runtime.js"
import {
  NodeSpawner,
  EngineCliClient,
  EngineCliWriter,
  type EngineClientOptions,
  type EngineCliCredentials,
  type EngineCliSpawner,
} from "./engine-cli/index.js"
import { CockpitWebUi } from "./web-ui/cockpit-web-ui.js"

export interface C7AdapterOptions {
  readonly cliPath: string
  readonly configPath: string
}

export class C7Adapter implements EngineAdapter {
  constructor(
    private readonly options: C7AdapterOptions,
    private readonly spawner: EngineCliSpawner,
  ) {}

  static create(options: C7AdapterOptions): C7Adapter {
    return new C7Adapter(options, new NodeSpawner())
  }

  runtime(connection: EngineConnection): ProcessRuntime {
    return C7ProcessRuntime.create(EngineCliClient.create(this.cliOptions(connection)))
  }

  commands(connection: EngineConnection): ProcessCommands {
    const options = this.cliOptions(connection)
    return new C7ProcessCommands(EngineCliWriter.create(options), EngineCliClient.create(options))
  }

  webUi(webUiUrl: string): EngineWebUi | undefined {
    return CockpitWebUi.at(webUiUrl)
  }

  private cliOptions(connection: EngineConnection): EngineClientOptions {
    return {
      cliPath: this.options.cliPath,
      connection: {
        url: connection.endpoint,
        credentials: this.engineCliCredentials(connection.credentials),
        configPath: this.options.configPath,
      },
      spawner: this.spawner,
    }
  }

  private engineCliCredentials(credentials: EngineCredentials): EngineCliCredentials {
    switch (credentials.kind) {
      case "none":
        return { kind: "none" }
      case "basic":
        return { kind: "basic", username: credentials.username, password: credentials.password }
    }
  }
}
