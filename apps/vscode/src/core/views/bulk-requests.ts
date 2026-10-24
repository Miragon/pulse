import type { InstanceSummary } from '../../contract/index.js';
import { ElementNames } from '../bpmn/element-names.js';
import type { BulkRequest } from '../panels/panel-context.js';
import type { BulkPlan } from '../panels/bulk-run.js';
import type { DefinitionView, InstanceScope } from '../protocol/index.js';
import { Labels } from './labels.js';

const SHOWN_ROWS = 3;
const SCOPE_LABELS: Readonly<Record<InstanceScope, string>> = {
  running: 'Running',
  withIncident: 'With incident',
  ended: 'Ended',
  all: 'All',
};

export interface BulkPreview {
  readonly plan: BulkPlan;
  readonly selected: number;
  readonly firstRows: readonly InstanceSummary[];
}

export class BulkRequests {
  static of(view: DefinitionView, preview: BulkPreview): BulkRequest {
    const { plan } = preview;
    const { wording } = plan.action;
    const count = plan.ids.length;
    const instances = Labels.plural(count, 'instance');
    const verb = Labels.capitalized(wording.verb);
    return {
      action: plan.action.kind,
      title: `${verb} ${instances} of ${view.processName} v${plan.version}?`,
      facts: [
        BulkRequests.filterFact(view),
        BulkRequests.rowsFact(preview.firstRows, count),
        ...BulkRequests.skippedFacts(preview),
        ...wording.lasting,
        'Checked just now',
      ],
      confirmLabel: `${verb} ${instances}`,
      selected: preview.selected,
      count,
      countPrompt: `Type ${count} to ${wording.verb} ${instances}`,
      warning: wording.warning,
      takesReason: plan.action.sendsReason,
      reasonPrompt: wording.reasonPrompt,
    };
  }

  static skippedFacts(preview: BulkPreview): string[] {
    const { skipped, action } = preview.plan;
    return skipped === 0 ? [] : [`${skipped} ${action.wording.skipped}, left alone`];
  }

  static rowsFact(rows: readonly InstanceSummary[], count: number): string {
    const shown = rows.slice(0, SHOWN_ROWS);
    const names = shown.map((row) => row.businessKey ?? Labels.shortId(row.id)).join(', ');
    return count > shown.length ? `${names} and ${count - shown.length} more` : names;
  }

  private static filterFact(view: DefinitionView): string {
    const { scope, elementId, businessKey } = view.filter;
    const element =
      elementId === undefined
        ? []
        : [`at ${ElementNames.of(view.diagramXml).get(elementId) ?? elementId}`];
    const key = businessKey === undefined ? [] : [`business key ${businessKey}`];
    return `Filter: ${[SCOPE_LABELS[scope], ...element, ...key].join(' · ')}`;
  }
}
