import type { BpmnProcessId, InstanceId } from "../../contract/index.js"
import type { BackLink } from "../../core/protocol/index.js"
import {
  DefinitionPanel,
  EnginePanel,
  InstancePanel,
  Labels,
  MigrationPanel,
  type DefinitionTarget,
  type LocalModel,
  type MigrationTarget,
  type Panel,
} from "../../core/index.js"
import { currentAppearance, renderWebviewHtml } from "@miragon/modeler-shell/vscode/extension"
import * as vscode from "vscode"
import type { Connection } from "../connections/connection.js"
import { EngineBulkRuns } from "../connections/engine-bulk-runs.js"
import type { LiveWiring } from "../live/live-wiring.js"
import { OpenPanel, THEMES, type SessionFactory } from "./open-panel.js"
import { PanelOrigins } from "./panel-origins.js"
import { PanelTitle } from "./panel-title.js"
import { VsCodePanelEffects, type PanelHost, type PanelNavigator } from "./vscode-panel-effects.js"

const VIEW_TYPE = "pulse.panel"

export interface PanelFocus {
  readonly engineName: string
  readonly bpmnProcessId?: BpmnProcessId
}

interface Placement {
  readonly key: string
  readonly connection: Connection
  readonly title: string
  readonly column: vscode.ViewColumn
  readonly focus?: PanelFocus
  readonly origin?: string | undefined
}

type OpenPanels<Session extends Panel> = Map<string, OpenPanel<Session>>

export class PanelManager implements vscode.Disposable {
  private readonly panels: OpenPanels<Panel> = new Map()
  private readonly models: OpenPanels<DefinitionPanel> = new Map()
  private readonly migrations: OpenPanels<MigrationPanel> = new Map()
  private readonly origins = new PanelOrigins((key) => this.openPanel(key) !== undefined)
  private readonly activated = new vscode.EventEmitter<PanelFocus>()
  private readonly bulkRuns = new EngineBulkRuns()
  readonly onDidActivate = this.activated.event
  private readonly subscription: vscode.Disposable

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly host: PanelHost,
    private readonly live: LiveWiring,
  ) {
    this.subscription = host.registry.onDidChange(() => {
      this.rebindAll()
    })
  }

  openDefinition(
    connection: Connection,
    target: DefinitionTarget,
    column = vscode.ViewColumn.Active,
    origin?: string,
  ): void {
    const variant = `${target.definitionId ?? "latest"}|${target.filter?.elementId ?? ""}`
    const key = `${connection.target.name}|definition|${target.bpmnProcessId}|${variant}`
    const focus = { engineName: connection.target.name, bpmnProcessId: target.bpmnProcessId }
    this.open(
      this.panels,
      { key, connection, title: target.bpmnProcessId, column, focus, origin },
      (context) => new DefinitionPanel(context, target),
    )
  }

  openEngine(connection: Connection, column = vscode.ViewColumn.Active): void {
    const name = connection.target.name
    this.open(
      this.panels,
      {
        key: `${name}|engine`,
        connection,
        title: PanelTitle.ofEngine(name),
        column,
        focus: { engineName: name },
      },
      (context) => new EnginePanel(context),
    )
  }

  openModel(
    connection: Connection,
    target: DefinitionTarget & { readonly localModel: LocalModel },
    modelUri: vscode.Uri,
  ): void {
    const key = `${connection.target.name}|model|${modelUri.toString()}`
    const existing = this.models.get(key)
    if (existing !== undefined) {
      existing.panel.reveal()
      void existing.session.compareWith(target.localModel)
      return
    }
    const placement = {
      key,
      connection,
      title: target.bpmnProcessId,
      column: vscode.ViewColumn.Active,
      focus: { engineName: connection.target.name, bpmnProcessId: target.bpmnProcessId },
    }
    this.open(this.models, placement, (context) => new DefinitionPanel(context, target))
  }

  openInstance(
    connection: Connection,
    instanceId: InstanceId,
    column = vscode.ViewColumn.Active,
    origin?: string,
  ): void {
    const key = `${connection.target.name}|instance|${instanceId}`
    this.open(
      this.panels,
      { key, connection, title: Labels.shortId(instanceId), column, origin },
      (context) => new InstancePanel(context, instanceId),
    )
  }

  openMigration(connection: Connection, target: MigrationTarget, origin?: string): void {
    const key = `${connection.target.name}|migration|${target.bpmnProcessId}`
    const existing = this.migrations.get(key)
    if (existing !== undefined) {
      existing.panel.reveal()
      void existing.session.retarget(target)
      return
    }
    const placement = {
      key,
      connection,
      title: `Migrate ${target.bpmnProcessId}`,
      column: vscode.ViewColumn.Active,
      focus: { engineName: connection.target.name, bpmnProcessId: target.bpmnProcessId },
      origin,
    }
    this.open(this.migrations, placement, (context) => new MigrationPanel(context, target))
  }

  nudgeLocal(): void {
    for (const open of this.all()) {
      open.nudgeLocal()
    }
  }

  dispose(): void {
    this.subscription.dispose()
    this.activated.dispose()
    for (const open of this.all()) {
      open.panel.dispose()
    }
  }

  private navigatorFor(key: string): PanelNavigator {
    return {
      openInstance: (connection, instanceId, column) => {
        this.openInstance(connection, instanceId, column, key)
      },
      openDefinition: (connection, target, column) => {
        this.openDefinition(connection, target, column, key)
      },
      openMigration: (connection, target) => {
        this.openMigration(connection, target, key)
      },
      goBack: () => {
        this.goBack(key)
      },
    }
  }

  private goBack(key: string): void {
    const origin = this.openPanel(this.origins.of(key))
    if (origin === undefined) {
      void vscode.commands.executeCommand("workbench.action.navigateBack")
      return
    }
    origin.panel.reveal()
  }

  private backOf(key: string): BackLink | undefined {
    const origin = this.openPanel(this.origins.of(key))
    return origin === undefined ? undefined : { label: origin.panel.title }
  }

  private openPanel(key: string | undefined): OpenPanel<Panel> | undefined {
    return key === undefined
      ? undefined
      : (this.panels.get(key) ?? this.models.get(key) ?? this.migrations.get(key))
  }

  private all(): OpenPanel<Panel>[] {
    return [...this.panels.values(), ...this.models.values(), ...this.migrations.values()]
  }

  private rebindAll(): void {
    for (const open of this.all()) {
      const connection = this.host.registry.byName(open.engineName)
      if (connection === undefined) {
        open.panel.dispose()
      } else {
        open.rebind(connection)
      }
    }
  }

  private open<Session extends Panel>(
    panels: OpenPanels<Session>,
    placement: Placement,
    createSession: SessionFactory<Session>,
  ): void {
    this.origins.remember(placement.key, placement.origin)
    const existing = panels.get(placement.key)
    if (existing !== undefined) {
      existing.panel.reveal(placement.column)
      return
    }
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, placement.title, placement.column, {
      enableScripts: true,
      localResourceRoots: [this.distUri()],
    })
    const navigator = this.navigatorFor(placement.key)
    const open = new OpenPanel(panel, placement.connection, createSession, {
      effectsFor: (connection) => new VsCodePanelEffects(connection, navigator, this.host),
      backOf: () => this.backOf(placement.key),
      sources: this.host.sources,
      live: this.live,
      bulkRunsFor: (connection) => this.bulkRuns.of(connection.target),
    })
    panel.webview.html = this.html(panel, placement.title)
    const activation = this.reportActivation(panel, placement.focus)
    panel.onDidDispose(() => {
      panels.delete(placement.key)
      this.origins.forget(placement.key)
      activation.dispose()
      open.dispose()
    })
    panels.set(placement.key, open)
  }

  private reportActivation(
    panel: vscode.WebviewPanel,
    focus: PanelFocus | undefined,
  ): vscode.Disposable {
    if (focus === undefined) {
      return new vscode.Disposable(() => undefined)
    }
    this.activated.fire(focus)
    return panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) {
        this.activated.fire(focus)
      }
    })
  }

  private distUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.extensionUri, "dist")
  }

  private html(panel: vscode.WebviewPanel, title: string): string {
    const asset = (file: string) =>
      panel.webview.asWebviewUri(vscode.Uri.joinPath(this.distUri(), file)).toString()
    return renderWebviewHtml({
      cspSource: panel.webview.cspSource,
      scriptUri: asset("webview.js"),
      styleUris: [asset("webview.css")],
      title,
      lang: "en",
      appearance: currentAppearance(vscode, THEMES),
      body: '<div id="pulse"></div>',
    })
  }
}
