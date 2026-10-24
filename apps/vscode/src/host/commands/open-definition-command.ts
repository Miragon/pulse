import { BpmnProcessId } from "../../contract/index.js"
import type { Connection } from "../connections/connection.js"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import type { PanelManager } from "../panels/panel-manager.js"
import { COMMAND } from "./command-ids.js"
import { EngineCommand } from "./engine-command.js"

export class OpenDefinitionCommand extends EngineCommand {
  readonly id = COMMAND.openDefinition

  constructor(
    registry: ConnectionRegistry,
    private readonly panels: PanelManager,
  ) {
    super(registry)
  }

  protected runOn(connection: Connection, [bpmnProcessId = ""]: readonly string[]): void {
    this.panels.openDefinition(connection, { bpmnProcessId: BpmnProcessId(bpmnProcessId) })
  }
}
