import type {
  BpmnProcessId,
  DefinitionId,
  EngineWebUi,
  IncidentDetails,
  InstanceId,
  SourceLocation,
} from "../../contract/index.js"
import type {
  BulkAnswer,
  BulkOutcomeReport,
  BulkRequest,
  InstanceChoice,
  LocalSources,
  MigrationTarget,
  OpenOptions,
  PanelEffects,
  WebUiTarget,
  WriteRequest,
} from "../../core/index.js"
import type { Environment, Problem } from "../../core/protocol/index.js"
import * as vscode from "vscode"
import type { ConnectionEditor } from "../commands/connection-editor.js"
import type { Connection } from "../connections/connection.js"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import type { WriteAudit } from "../connections/write-audit.js"
import { PulseSettings } from "../connections/pulse-settings.js"
import { NotificationText } from "../notification-text.js"
import type { IncidentDocuments } from "./incident-documents.js"
import type { SourceNavigation } from "./source-navigation.js"
import type { WriteConfirmation } from "./write-confirmation.js"

export interface PanelNavigator {
  openInstance(connection: Connection, instanceId: InstanceId, column: vscode.ViewColumn): void
  openDefinition(
    connection: Connection,
    target: { readonly bpmnProcessId: BpmnProcessId; readonly definitionId?: DefinitionId },
    column: vscode.ViewColumn,
  ): void
  openMigration(connection: Connection, target: MigrationTarget): void
  goBack(): void
}

export interface PanelHost {
  readonly registry: ConnectionRegistry
  readonly documents: IncidentDocuments
  readonly editor: ConnectionEditor
  readonly confirmation: WriteConfirmation
  readonly audit: WriteAudit
  readonly navigation: SourceNavigation
  readonly sources?: LocalSources
}

export class VsCodePanelEffects implements PanelEffects {
  constructor(
    private readonly connection: Connection,
    private readonly navigator: PanelNavigator,
    private readonly host: PanelHost,
  ) {}

  openInstance(instanceId: InstanceId, options: OpenOptions): void {
    this.navigator.openInstance(this.connection, instanceId, this.columnFor(options))
  }

  openDefinition(
    bpmnProcessId: BpmnProcessId,
    definitionId: DefinitionId,
    options: OpenOptions,
  ): void {
    this.navigator.openDefinition(
      this.connection,
      { bpmnProcessId, definitionId },
      this.columnFor(options),
    )
  }

  openLatestDefinition(bpmnProcessId: BpmnProcessId, options: OpenOptions): void {
    this.navigator.openDefinition(this.connection, { bpmnProcessId }, this.columnFor(options))
  }

  openMigration(target: MigrationTarget): void {
    this.navigator.openMigration(this.connection, target)
  }

  async pickInstance(
    title: string,
    choices: readonly InstanceChoice[],
  ): Promise<InstanceId | undefined> {
    const picked = await vscode.window.showQuickPick(
      choices.map((choice) => ({
        label: choice.label,
        description: choice.description,
        detail: choice.instanceId,
        instanceId: choice.instanceId,
      })),
      { title, placeHolder: "Instances with an incident come first" },
    )
    return picked?.instanceId
  }

  openWebUi(target: WebUiTarget): void {
    const webUi = this.connection.webUi
    if (webUi !== undefined) {
      void vscode.env.openExternal(vscode.Uri.parse(this.webUiUrl(webUi, target)))
    }
  }

  goBack(): void {
    this.navigator.goBack()
  }

  showIncidentDetails(title: string, details: IncidentDetails): void {
    void this.host.documents.show(title, details)
  }

  copyToClipboard(text: string, label: string): void {
    void vscode.env.clipboard.writeText(text)
    vscode.window.setStatusBarMessage(`$(check) Copied ${label}`, 2000)
  }

  editConnection(): void {
    void this.host.editor.edit(this.connection)
  }

  setCredentials(): void {
    void this.host.editor.setCredentialsOf(this.connection)
  }

  reportProblem(problem: Problem): void {
    void vscode.window.showErrorMessage(
      NotificationText.withoutLinks(`${problem.title} ${problem.detail}`),
    )
  }

  confirmWrite(request: WriteRequest): Promise<boolean> {
    return this.host.confirmation.confirm(this.connection, request)
  }

  confirmBulk(request: BulkRequest): Promise<BulkAnswer | undefined> {
    return this.host.confirmation.confirmBulk(this.connection, request)
  }

  reportBulkOutcome(report: BulkOutcomeReport): void {
    this.host.audit.recordOutcome(
      { target: this.connection.target, environment: this.connection.badge.environment },
      report,
    )
  }

  reportWritten(message: string): void {
    this.host.registry.noteWrite()
    void vscode.window.showInformationMessage(NotificationText.withoutLinks(message))
  }

  openModel(location: SourceLocation, elementId?: string): void {
    void this.host.navigation.openModel(location, elementId)
  }

  openSource(location: SourceLocation): void {
    void this.host.navigation.openSource(location)
  }

  turnOnLiveUpdates(environment: Environment): void {
    PulseSettings.turnOnLiveUpdates(environment).catch((error: unknown) => {
      void vscode.window.showErrorMessage(
        `Pulse could not turn on live updates in your user settings: ${String(error)}`,
      )
    })
  }

  private webUiUrl(webUi: EngineWebUi, target: WebUiTarget): string {
    switch (target.kind) {
      case "engine":
        return webUi.overviewUrl()
      case "instance":
        return webUi.instanceUrl(target.instance)
      case "definition":
        return webUi.definitionUrl(target.definition)
    }
  }

  private columnFor({ toSide }: OpenOptions): vscode.ViewColumn {
    return toSide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active
  }
}
