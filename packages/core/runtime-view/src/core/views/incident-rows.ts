import { IncidentId } from "@miragon/pulse-engine-core"
import type { CauseSourceCode, IncidentCardData, IncidentTextKind } from "@miragon/pulse-screens"
import type { CauseLabel, IncidentRow } from "../protocol/index.js"
import { CalledInstanceLinks } from "./called-instance-links.js"
import { ModelFactsView } from "./model-facts-view.js"
import type { InstanceSnapshot } from "./instance-snapshot.js"
import { Labels } from "./labels.js"

const CAUSE_LABELS: Readonly<Record<CauseSourceCode, CauseLabel>> = {
  stacktrace: "Root cause",
  workerError: "Worker error",
  errorMessage: "Cause",
}

const DETAILS_LABELS: Readonly<Record<IncidentTextKind, string>> = {
  stacktrace: "Stacktrace",
  errorMessage: "Error message",
}

export class IncidentRows {
  constructor(
    private readonly snapshot: InstanceSnapshot,
    private readonly cards: readonly IncidentCardData[],
  ) {}

  rows(): IncidentRow[] {
    return this.cards.map((card) => this.rowOf(card))
  }

  private rowOf(card: IncidentCardData): IncidentRow {
    const { rootIncident, liesIn, job, text } = card
    return {
      id: rootIncident.id,
      shortId: Labels.shortId(rootIncident.id),
      elementId: card.elementId,
      typeLabel: Labels.humanize(card.type),
      engineType: card.type,
      message: card.message,
      createdAt: card.createdAt,
      ...this.causeOf(card),
      ...(card.retriesLeft === undefined ? {} : { retriesLeft: card.retriesLeft }),
      ...(text === null ? {} : { detailsLabel: DETAILS_LABELS[text] }),
      ...(liesIn === null ? {} : { inCalledInstance: CalledInstanceLinks.of(liesIn) }),
      ...(job === undefined
        ? {}
        : {
            job: {
              id: job.id,
              shortId: Labels.shortId(job.id),
              ...(job.type === undefined ? {} : { type: job.type }),
            },
          }),
      ...this.actionsOf(card),
    }
  }

  private causeOf({
    rootCauseLine,
    causeSource,
  }: IncidentCardData): Pick<IncidentRow, "rootCause" | "causeLabel"> {
    return rootCauseLine === null || causeSource === null
      ? {}
      : { rootCause: rootCauseLine, causeLabel: CAUSE_LABELS[causeSource] }
  }

  private actionsOf({
    rootIncident,
    job,
  }: IncidentCardData): Pick<IncidentRow, "retryable" | "model"> {
    const modelLink = this.snapshot.modelLinks?.get(IncidentId(rootIncident.id))
    return {
      ...(this.snapshot.writable && job !== undefined ? { retryable: true as const } : {}),
      ...(modelLink === undefined ? {} : { model: ModelFactsView.of(modelLink, job?.type) }),
    }
  }
}
