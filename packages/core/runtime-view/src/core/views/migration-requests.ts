import type { BulkRequest } from "../panels/panel-context.js"
import type { MigrationState } from "../panels/migration-reads.js"
import { BulkRequests, type BulkPreview } from "./bulk-requests.js"
import { Labels } from "./labels.js"
import { MigrationElements } from "./migration-elements.js"
import { MigrationFacts } from "./migration-facts.js"
import { MigrationRows } from "./migration-rows.js"

export class MigrationRequests {
  private readonly elements: MigrationElements

  constructor(
    private readonly state: MigrationState,
    private readonly preview: BulkPreview,
  ) {
    this.elements = new MigrationElements(state.sourceXml, state.targetXml)
  }

  request(): BulkRequest {
    const { plan } = this.preview
    const count = plan.ids.length
    const instances = Labels.plural(count, "instance")
    const { source } = this.state
    const target = this.targetVersion()
    return {
      action: plan.action.kind,
      title: `Migrate ${instances} of ${source.name ?? source.bpmnProcessId} v${source.version} to v${target}?`,
      facts: [
        BulkRequests.rowsFact(this.preview.firstRows, count),
        ...BulkRequests.skippedFacts(this.preview),
        ...this.changes(),
        ...this.stays(),
        plan.action.wording.warning,
        "Checked just now",
      ],
      confirmLabel: `Migrate ${instances}`,
      selected: this.preview.selected,
      count,
      countPrompt: BulkRequests.countPrompt(count, "migrate"),
      warning: plan.action.wording.warning,
      takesReason: false,
      reasonPrompt: "",
      auditFields: {
        source: source.id,
        target: this.state.target?.id ?? "",
        mappings: this.state.mappings.length,
        leftOut: this.state.leftOut.length,
        incidents: this.incidents(),
        mode: "batch",
      },
    }
  }

  private changes(): string[] {
    const { leftOut, source } = this.state
    return [
      ...(leftOut.length === 0
        ? []
        : [`${Labels.count(leftOut.length)} left out, staying on v${source.version}`]),
      MigrationFacts.ownWay(source.version, this.preview.plan.ids.length),
      ...new MigrationRows(this.state).restartingTimers(),
      ...MigrationFacts.versionNotes(
        source.version,
        this.targetVersion(),
        this.state.versions[0]?.definition.version,
      ),
    ]
  }

  private stays(): string[] {
    return [
      ...MigrationFacts.incidents(this.incidents(), this.targetVersion()),
      ...MigrationFacts.modelFacts(this.elements),
    ]
  }

  private incidents(): number {
    return this.preview.firstRows.filter((instance) => instance.hasIncident).length
  }

  private targetVersion(): number {
    return this.state.target?.version ?? this.state.source.version
  }
}
