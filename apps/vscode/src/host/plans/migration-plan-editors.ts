import type { Connection } from "@miragon/pulse-runtime-view/host-kit"
import * as vscode from "vscode"
import type { PanelManager } from "../panels/panel-manager.js"
import type { PlanEngines } from "./plan-engines.js"

const TITLE = "Edit Migration Plan"
const REMEMBERED = "pulse.planEngines"

export class MigrationPlanEditors implements vscode.CustomTextEditorProvider {
  static readonly VIEW_TYPE = "pulse.migrationPlan"
  private readonly chosen = new Map<string, Connection>()

  constructor(
    private readonly engines: Pick<PlanEngines, "choose">,
    private readonly panels: Pick<PanelManager, "adoptMigrationPlan" | "rebindMigrationPlans">,
    private readonly memory: vscode.Memento,
  ) {}

  async open(file: vscode.Uri): Promise<void> {
    const connection = await this.engines.choose(TITLE)
    if (connection === undefined) {
      return
    }
    this.remember(file, connection)
    if (!this.panels.rebindMigrationPlans(file, connection)) {
      this.chosen.set(file.toString(), connection)
    }
    await vscode.commands.executeCommand("vscode.openWith", file, MigrationPlanEditors.VIEW_TYPE)
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const key = document.uri.toString()
    const chosen = this.chosen.get(key)
    this.chosen.delete(key)
    const connection = chosen ?? (await this.engines.choose(TITLE, this.remembered()[key]))
    if (connection === undefined) {
      panel.dispose()
      await vscode.commands.executeCommand("vscode.openWith", document.uri, "default")
      return
    }
    this.remember(document.uri, connection)
    const open = this.panels.adoptMigrationPlan(connection, document, panel)
    const changes = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === document) {
        void open?.session.changed()
      }
    })
    panel.onDidDispose(() => {
      changes.dispose()
    })
  }

  private remembered(): Readonly<Record<string, string>> {
    return this.memory.get<Record<string, string>>(REMEMBERED) ?? {}
  }

  private remember(file: vscode.Uri, connection: Connection): void {
    void this.memory.update(REMEMBERED, {
      ...this.remembered(),
      [file.toString()]: connection.target.name,
    })
  }
}
