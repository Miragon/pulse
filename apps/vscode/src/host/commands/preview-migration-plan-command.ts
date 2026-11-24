import { FailingRuntime } from "@miragon/pulse-engine-core"
import type { Connection, EngineRoot } from "@miragon/pulse-runtime-view/host-kit"
import * as vscode from "vscode"
import { ActiveModel } from "../active-model.js"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import type { PanelManager } from "../panels/panel-manager.js"
import { PlanFiles } from "../plans/plan-files.js"
import type { Command } from "./command.js"
import { COMMAND } from "./command-ids.js"
import type { ConnectionPicker } from "./connection-picker.js"

export class PreviewMigrationPlanCommand implements Command {
  readonly id = COMMAND.previewMigrationPlan

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly picker: ConnectionPicker,
    private readonly panels: Pick<PanelManager, "openMigrationPlan">,
    private readonly engines: Pick<EngineRoot, "plans">,
  ) {}

  async run(file?: unknown): Promise<void> {
    const plan = file instanceof vscode.Uri ? file : ActiveModel.uri()
    if (plan === undefined || !PlanFiles.isPlan(plan)) {
      void vscode.window.showInformationMessage(
        "Open a migration plan file (.migration.json) to preview it.",
      )
      return
    }
    const connection = await this.chosenEngine()
    if (connection !== undefined) {
      this.panels.openMigrationPlan(connection, plan)
    }
  }

  private async chosenEngine(): Promise<Connection | undefined> {
    const connections = this.registry.all()
    const candidates = connections.filter((connection) =>
      PreviewMigrationPlanCommand.plans(connection),
    )
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage(this.noEngineText(connections))
      return undefined
    }
    return candidates.length === 1
      ? candidates[0]
      : this.picker.pick("Preview Migration Plan", candidates)
  }

  private noEngineText(connections: readonly Connection[]): string {
    if (connections.length === 0) {
      return "Pulse lists no engine, so it can't preview a plan. Configure one in the Engines view."
    }
    const [first, ...others] = connections
      .filter(
        ({ runtime, target }) => runtime instanceof FailingRuntime && this.engines.plans(target),
      )
      .map(({ target }) => target.name)
    if (first === undefined) {
      return "None of the configured engines checks migration plans, so Pulse can't preview one."
    }
    const last = others.pop()
    return last === undefined
      ? `Pulse refuses the connection to ${first}, so it can't preview a plan there. Expand ${first} in the Engines view to see why and what to change.`
      : `Pulse refuses the connections to ${[first, ...others].join(", ")} and ${last}, so it can't preview a plan there. Expand them in the Engines view to see why and what to change.`
  }

  private static plans({ runtime }: Connection): boolean {
    return !(runtime instanceof FailingRuntime) && runtime.checkMigration !== undefined
  }
}
