import { FailingRuntime } from "@miragon/pulse-engine-core"
import type { Connection } from "@miragon/pulse-runtime-view/host-kit"
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
    const candidates = this.registry
      .all()
      .filter((connection) => PreviewMigrationPlanCommand.plans(connection))
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage(
        "None of the configured engines checks migration plans, so Pulse can't preview one.",
      )
      return undefined
    }
    return candidates.length === 1
      ? candidates[0]
      : this.picker.pick("Preview Migration Plan", candidates)
  }

  private static plans({ runtime }: Connection): boolean {
    return !(runtime instanceof FailingRuntime) && runtime.checkMigration !== undefined
  }
}
