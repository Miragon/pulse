import type {
  BpmnProcessId,
  DefinitionId,
  EngineWebUi,
  IncidentDetails,
  InstanceId,
  SourceLocation,
} from "../../../src/contract/index.js"
import type {
  BulkAnswer,
  BulkOutcomeReport,
  BulkRequest,
  InstanceChoice,
  MigrationTarget,
  PanelEffects,
  WebUiTarget,
  WriteRequest,
} from "../../../src/core/index.js"
import type { Environment, Problem } from "../../../src/core/protocol/index.js"
import type { Connection } from "../../../src/host/connections/connection.js"
import type { WriteAudit } from "../../../src/host/connections/write-audit.js"
import { NotificationText } from "../../../src/host/notification-text.js"
import type { EffectsHost } from "./effects-host.js"

export class OrcaPanelEffects implements PanelEffects {
  constructor(
    private readonly connection: Connection,
    private readonly key: string,
    private readonly host: EffectsHost,
    private readonly audit: WriteAudit,
  ) {}

  openInstance(instanceId: InstanceId): void {
    this.host.navigation.open(this.engine, { view: "instance", instanceId }, this.key)
  }

  openDefinition(bpmnProcessId: BpmnProcessId, definitionId: DefinitionId): void {
    this.host.navigation.open(
      this.engine,
      { view: "definition", bpmnProcessId, definitionId },
      this.key,
    )
  }

  openLatestDefinition(bpmnProcessId: BpmnProcessId): void {
    this.host.navigation.open(this.engine, { view: "definition", bpmnProcessId }, this.key)
  }

  openMigration(target: MigrationTarget): void {
    this.host.navigation.openMigration(this.engine, target, this.key)
  }

  async pickInstance(
    title: string,
    choices: readonly InstanceChoice[],
  ): Promise<InstanceId | undefined> {
    const key = await this.host.services.pick(title, choices)
    return choices.find((choice) => choice.instanceId === key)?.instanceId
  }

  openWebUi(target: WebUiTarget): void {
    const webUi = this.connection.webUi
    if (webUi !== undefined) {
      this.host.navigation.frameAction(this.key, {
        kind: "openExternal",
        url: OrcaPanelEffects.webUiUrl(webUi, target),
      })
    }
  }

  goBack(): void {
    this.host.navigation.goBack(this.key)
  }

  showIncidentDetails(title: string, details: IncidentDetails): void {
    this.host.services.showIncident(this.engine, title, details)
  }

  copyToClipboard(text: string, label: string): void {
    this.host.navigation.frameAction(this.key, { kind: "copy", text, label })
  }

  editConnection(): void {
    this.host.services.editConnection()
  }

  setCredentials(): void {
    this.host.services.askForLogin(this.connection)
  }

  reportProblem(problem: Problem): void {
    this.host.services.notice({
      tone: "danger",
      text: NotificationText.printable(`${problem.title} ${problem.detail}`),
    })
  }

  confirmWrite(request: WriteRequest): Promise<boolean> {
    return this.host.services.confirmation.confirm(this.connection, request)
  }

  confirmBulk(request: BulkRequest): Promise<BulkAnswer | undefined> {
    return this.host.services.confirmation.confirmBulk(this.connection, request)
  }

  reportBulkOutcome(report: BulkOutcomeReport): void {
    this.audit.recordOutcome(
      { target: this.connection.target, environment: this.connection.badge.environment },
      report,
    )
  }

  reportWritten(message: string): void {
    this.host.services.noteWrite()
    this.host.services.notice({ tone: "success", text: NotificationText.printable(message) })
  }

  openModel(location: SourceLocation): void {
    this.host.services.openLocation(location)
  }

  openSource(location: SourceLocation): void {
    this.host.services.openLocation(location)
  }

  turnOnLiveUpdates(environment: Environment): void {
    this.host.services.turnOnLiveUpdates(environment)
  }

  private get engine(): string {
    return this.connection.target.name
  }

  private static webUiUrl(webUi: EngineWebUi, target: WebUiTarget): string {
    switch (target.kind) {
      case "engine":
        return webUi.overviewUrl()
      case "instance":
        return webUi.instanceUrl(target.instance)
      case "definition":
        return webUi.definitionUrl(target.definition)
    }
  }
}
