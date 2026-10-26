import type { Connection } from "../connections/connection.js"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import type { PanelManager } from "../panels/panel-manager.js"
import type { Command } from "./command.js"
import { COMMAND } from "./command-ids.js"
import type { ConnectionPicker } from "./connection-picker.js"

export class OpenEngineOverviewCommand implements Command {
  readonly id = COMMAND.openEngineOverview

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly picker: ConnectionPicker,
    private readonly panels: Pick<PanelManager, "openEngine">,
  ) {}

  async run(engine?: unknown): Promise<void> {
    const connection =
      typeof engine === "string" ? this.registry.byName(engine) : await this.chosenEngine()
    if (connection !== undefined) {
      this.panels.openEngine(connection)
    }
  }

  private async chosenEngine(): Promise<Connection | undefined> {
    const all = this.registry.all()
    return all.length <= 1 ? all[0] : this.picker.pick("Open Engine Overview")
  }
}
