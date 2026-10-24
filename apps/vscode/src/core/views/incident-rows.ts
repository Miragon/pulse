import type { Incident, IncidentDetails, IncidentJob } from '../../contract/index.js';
import { RootCause } from '../incidents/root-cause.js';
import type { IncidentRow, JobLink } from '../protocol/index.js';
import type { CalledInstanceLinks } from './called-instance-links.js';
import { ModelFactsView } from './model-facts-view.js';
import type { InstanceSnapshot } from './instance-snapshot.js';
import { Labels } from './labels.js';

export class IncidentRows {
  constructor(
    private readonly snapshot: InstanceSnapshot,
    private readonly links: CalledInstanceLinks,
  ) {}

  rows(): IncidentRow[] {
    return this.snapshot.detail.incidents.map((incident) => this.rowOf(incident));
  }

  private rowOf(incident: Incident): IncidentRow {
    const details = this.completeDetails(incident);
    const cause = details === undefined ? undefined : RootCause.of(details.text);
    const link = this.links.linkTo(incident.instanceId);
    const detailsKind = incident.details?.kind;
    return {
      id: incident.id,
      shortId: Labels.shortId(incident.id),
      elementId: incident.elementId,
      typeLabel: Labels.humanize(incident.type),
      engineType: incident.type,
      message: incident.message,
      createdAt: incident.createdAt,
      ...(cause === undefined ? {} : { rootCause: cause }),
      ...(incident.retriesLeft === undefined ? {} : { retriesLeft: incident.retriesLeft }),
      ...(detailsKind === undefined
        ? {}
        : { detailsLabel: detailsKind === 'stacktrace' ? 'Stacktrace' : 'Error message' }),
      ...(link === undefined ? {} : { inCalledInstance: link }),
      ...(incident.job === undefined ? {} : { job: this.jobLink(incident.job) }),
      ...this.actionsOf(incident),
    };
  }

  private actionsOf(incident: Incident): Pick<IncidentRow, 'retryable' | 'model'> {
    const modelLink = this.snapshot.modelLinks?.get(incident.id);
    return {
      ...(this.isRetryable(incident) ? { retryable: true as const } : {}),
      ...(modelLink === undefined
        ? {}
        : { model: ModelFactsView.of(modelLink, incident.job?.type) }),
    };
  }

  private completeDetails(incident: Incident): IncidentDetails | undefined {
    const details = this.snapshot.fullDetails.get(incident.id) ?? incident.details;
    return details?.truncated === false ? details : undefined;
  }

  private jobLink(job: IncidentJob): JobLink {
    return {
      id: job.id,
      shortId: Labels.shortId(job.id),
      ...(job.type === undefined ? {} : { type: job.type }),
    };
  }

  private isRetryable(incident: Incident): boolean {
    return this.snapshot.writable && incident.job !== undefined;
  }
}
