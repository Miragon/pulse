import type { BulkRequest } from '../panels/panel-context.js';
import type { MigrationState } from '../panels/migration-reads.js';
import { BulkRequests, type BulkPreview } from './bulk-requests.js';
import { Labels } from './labels.js';
import { MigrationElements } from './migration-elements.js';
import { MigrationRows } from './migration-rows.js';

const TRIGGERS = 'New or unmapped timers and subscriptions start now.';
const CALLED = 'Called instances stay on their version.';

export class MigrationRequests {
  private readonly elements: MigrationElements;

  constructor(
    private readonly state: MigrationState,
    private readonly preview: BulkPreview,
  ) {
    this.elements = new MigrationElements(state.sourceXml, state.targetXml);
  }

  request(): BulkRequest {
    const { plan } = this.preview;
    const count = plan.ids.length;
    const instances = Labels.plural(count, 'instance');
    const { source } = this.state;
    const target = this.targetVersion();
    return {
      action: plan.action.kind,
      title: `Migrate ${instances} of ${source.name ?? source.bpmnProcessId} v${source.version} to v${target}?`,
      facts: [
        BulkRequests.rowsFact(this.preview.firstRows, count),
        ...BulkRequests.skippedFacts(this.preview),
        ...this.changes(),
        ...this.stays(),
        plan.action.wording.warning,
        'Checked just now',
      ],
      confirmLabel: `Migrate ${instances}`,
      selected: this.preview.selected,
      count,
      countPrompt: `Type ${count} to migrate ${instances}`,
      warning: plan.action.wording.warning,
      takesReason: false,
      reasonPrompt: '',
      auditFields: {
        source: source.id,
        target: this.state.target?.id ?? '',
        mappings: this.state.mappings.length,
        leftOut: this.state.leftOut.length,
        incidents: this.incidents(),
        mode: 'batch',
      },
    };
  }

  private changes(): string[] {
    const { leftOut, source } = this.state;
    return [
      ...(leftOut.length === 0
        ? []
        : [`${leftOut.length} left out, staying on v${source.version}`]),
      this.ownWayFact(),
      ...new MigrationRows(this.state).restartingTimers(),
      ...this.versionFacts(),
    ];
  }

  private ownWayFact(): string {
    const version = this.state.source.version;
    return this.preview.plan.ids.length === 1
      ? `If it fails, it stays on v${version}.`
      : `Each migrates on its own; failed ones stay on v${version}.`;
  }

  private stays(): string[] {
    const incidents = this.incidents();
    const target = this.targetVersion();
    return [
      ...this.incidentFact(incidents, target),
      ...(this.elements.hasCallActivity() ? [CALLED] : []),
      ...(this.elements.hasCatchingEvents() ? [TRIGGERS] : []),
    ];
  }

  private incidentFact(incidents: number, target: number): string[] {
    if (incidents === 0) {
      return [];
    }
    return incidents === 1
      ? [`1 has an incident and keeps it; retry it on v${target}.`]
      : [`${incidents} have an incident and keep it; retry them on v${target}.`];
  }

  private versionFacts(): string[] {
    const target = this.targetVersion();
    const latest = this.state.versions[0]?.definition.version ?? target;
    if (target < this.state.source.version) {
      return [`v${target} is older than v${this.state.source.version}.`];
    }
    return target < latest ? [`v${target} is not the latest version (v${latest}).`] : [];
  }

  private incidents(): number {
    return this.preview.firstRows.filter((instance) => instance.hasIncident).length;
  }

  private targetVersion(): number {
    return this.state.target?.version ?? this.state.source.version;
  }
}
