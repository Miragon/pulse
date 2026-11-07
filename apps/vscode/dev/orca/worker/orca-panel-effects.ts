import type { InstanceId } from "../../../src/contract/index.js"
import type { InstanceChoice, PanelEffects } from "../../../src/core/index.js"
import type { ViewRequest } from "../protocol.js"

type Opener = (request: ViewRequest) => void
type Log = (message: string) => void

export class OrcaPanelEffects implements PanelEffects {
  constructor(
    private readonly engine: string,
    private readonly open: Opener,
    private readonly log: Log,
  ) {}

  openInstance(instanceId: InstanceId): void {
    this.open({ engine: this.engine, view: "instance", instanceId })
  }

  openDefinition(bpmnProcessId: string, definitionId: string): void {
    this.open({ engine: this.engine, view: "definition", bpmnProcessId, definitionId })
  }

  openLatestDefinition(bpmnProcessId: string): void {
    this.open({ engine: this.engine, view: "definition", bpmnProcessId })
  }

  pickInstance(
    _title: string,
    choices: readonly InstanceChoice[],
  ): Promise<InstanceId | undefined> {
    return Promise.resolve(choices[0]?.instanceId)
  }

  confirmWrite(): Promise<boolean> {
    return Promise.resolve(false)
  }

  confirmBulk(): Promise<undefined> {
    return Promise.resolve(undefined)
  }

  openMigration(): void {
    this.skipped("openMigration")
  }

  openWebUi(): void {
    this.skipped("openWebUi")
  }

  goBack(): void {
    this.skipped("goBack")
  }

  showIncidentDetails(title: string): void {
    this.skipped(`showIncidentDetails ${title}`)
  }

  copyToClipboard(_text: string, label: string): void {
    this.skipped(`copyToClipboard ${label}`)
  }

  editConnection(): void {
    this.skipped("editConnection")
  }

  setCredentials(): void {
    this.skipped("setCredentials: use the Pulse panel")
  }

  reportProblem(problem: { readonly title: string }): void {
    this.log(`[${this.engine}] ${problem.title}`)
  }

  reportBulkOutcome(): void {
    this.skipped("reportBulkOutcome")
  }

  reportWritten(message: string): void {
    this.log(`[${this.engine}] ${message}`)
  }

  openModel(): void {
    this.skipped("openModel")
  }

  openSource(): void {
    this.skipped("openSource")
  }

  turnOnLiveUpdates(): void {
    this.skipped("turnOnLiveUpdates")
  }

  private skipped(effect: string): void {
    this.log(`[${this.engine}] not in the spike: ${effect}`)
  }
}
