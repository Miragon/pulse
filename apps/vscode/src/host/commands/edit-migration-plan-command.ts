import * as vscode from "vscode"
import { ActiveModel } from "../active-model.js"
import type { MigrationPlanEditors } from "../plans/migration-plan-editors.js"
import { PlanFiles } from "../plans/plan-files.js"
import type { Command } from "./command.js"
import { COMMAND } from "./command-ids.js"

export class EditMigrationPlanCommand implements Command {
  readonly id = COMMAND.editMigrationPlan

  constructor(private readonly editors: Pick<MigrationPlanEditors, "open">) {}

  async run(file?: unknown): Promise<void> {
    const plan = file instanceof vscode.Uri ? file : ActiveModel.uri()
    if (plan === undefined || !PlanFiles.isPlan(plan)) {
      void vscode.window.showInformationMessage(
        "Open a migration plan file (.migration.json) to edit it.",
      )
      return
    }
    await this.editors.open(plan)
  }
}
