import type { DefinitionSummary } from "../contract/index.js"
import { BpmnProcessIds } from "../core/index.js"
import * as vscode from "vscode"
import { ActiveModel } from "./active-model.js"
import { COMMAND } from "./commands/command-ids.js"
import type { Connection } from "./connections/connection.js"
import type { ConnectionRegistry } from "./connections/connection-registry.js"

const ENVIRONMENT_NAMES = {
  local: "LOCAL",
  test: "TEST",
  production: "PROD",
  unclassified: "unclassified",
} as const

const GLANCE_REUSE_MS = 60_000

interface ModelRuntime {
  readonly processName: string
  readonly running: number
  readonly withIncident: number
}

export class EngineStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    "pulse.engine",
    vscode.StatusBarAlignment.Left,
    50,
  )
  private readonly subscriptions: vscode.Disposable[]
  private ticket = 0
  private watching: (() => void) | undefined
  private watched: Connection | undefined

  constructor(private readonly registry: ConnectionRegistry) {
    this.item.name = "Pulse Engine"
    const render = () => void this.render()
    this.subscriptions = [
      registry.onDidChange(render),
      registry.onDidWrite(render),
      vscode.window.tabGroups.onDidChangeTabs(render),
      vscode.window.onDidChangeActiveTextEditor(render),
    ]
    render()
  }

  dispose(): void {
    this.watching?.()
    for (const subscription of this.subscriptions) {
      subscription.dispose()
    }
    this.item.dispose()
  }

  private async render(): Promise<void> {
    const ticket = ++this.ticket
    const active = this.registry.active()
    this.watch(active)
    if (active === undefined) {
      this.item.hide()
      return
    }
    const model = await this.modelRuntime(active).catch(() => undefined)
    if (ticket !== this.ticket) {
      return
    }
    this.item.text = model === undefined ? this.engineText(active) : this.modelText(active, model)
    this.item.command = model === undefined ? COMMAND.switchEngine : COMMAND.showRuntimeData
    this.item.tooltip = this.tooltipOf(active, model)
    this.item.backgroundColor =
      active.badge.environment === "production"
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : undefined
    this.item.show()
  }

  private async modelRuntime(connection: Connection): Promise<ModelRuntime | undefined> {
    const ids = await this.modelIds()
    if (ids.length === 0 || connection.lane.isBlocked) {
      return undefined
    }
    const summaries = await this.summariesOf(connection)
    const summary = summaries.find((candidate) => ids.includes(candidate.latest.bpmnProcessId))
    return summary === undefined
      ? undefined
      : {
          processName: summary.latest.name ?? summary.latest.bpmnProcessId,
          running: summary.running,
          withIncident: summary.withIncident,
        }
  }

  private async modelIds(): Promise<readonly string[]> {
    const uri = ActiveModel.uri()
    if (uri?.path.endsWith(".bpmn") !== true) {
      return []
    }
    const xml = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
    return BpmnProcessIds.of(xml)
  }

  private summariesOf(connection: Connection): Promise<readonly DefinitionSummary[]> {
    return connection.definitions.read(GLANCE_REUSE_MS)
  }

  private watch(connection: Connection | undefined): void {
    if (connection === this.watched) {
      return
    }
    this.watching?.()
    this.watched = connection
    this.watching = connection?.definitions.subscribe(() => {
      void this.render()
    })
  }

  private engineText(connection: Connection): string {
    const icon = connection.badge.access?.writable === true ? "$(edit)" : "$(eye)"
    const environment = connection.badge.environment
    const label = environment === "unclassified" ? "" : ` · ${ENVIRONMENT_NAMES[environment]}`
    return `${icon} ${connection.target.name}${label}`
  }

  private modelText(connection: Connection, model: ModelRuntime): string {
    const incidents = model.withIncident > 0 ? ` · $(error) ${model.withIncident}` : ""
    return `${this.engineText(connection)} · ${model.running} running${incidents}`
  }

  private tooltipOf(
    connection: Connection,
    model: ModelRuntime | undefined,
  ): vscode.MarkdownString {
    const environment = ENVIRONMENT_NAMES[connection.badge.environment]
    const lines = [
      `**Pulse** · ${connection.badge.access?.note ?? "Read-only."}`,
      `${connection.target.name} (${environment}) · ${connection.target.endpoint}`,
      model === undefined
        ? "Click to switch the engine."
        : `${model.processName}: ${model.running} running, ${model.withIncident} with an incident. Click to show its runtime data.`,
    ]
    const tooltip = new vscode.MarkdownString(lines.join("\n\n"))
    tooltip.isTrusted = false
    return tooltip
  }
}
