import type { ComponentChildren } from "preact"
import { glyphs } from "../components/lucide-glyphs.json"
import type { IncidentRow } from "../../core/protocol/index.js"
import { EmptyHint } from "../components/empty-hint.js"
import { Icon } from "../components/icon.js"
import { IdText } from "../components/id-text.js"
import { StateLabel } from "../components/state-label.js"
import { TimeLabels } from "../format/time-labels.js"
import { useHost } from "../host/host-context.js"
import { useWriteState } from "../host/write-context.js"
import { WriteStates } from "../host/write-states.js"
import { CalledInstanceLink } from "./called-instance-link.js"
import { IncidentModelActions, IncidentModelFacts } from "./incident-model.js"

export interface IncidentsTabProps {
  readonly incidents: readonly IncidentRow[]
  readonly elementName: (elementId: string) => string
}

function Fact({
  label,
  children,
}: {
  readonly label: string
  readonly children: ComponentChildren
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

function IdWithKind({
  id,
  shortId,
  label,
  kind,
  kindTitle,
}: {
  readonly id: string
  readonly shortId: string
  readonly label: string
  readonly kind: string | undefined
  readonly kindTitle: string
}) {
  return (
    <>
      <IdText id={id} shortId={shortId} label={label} />
      {kind !== undefined && (
        <span class="muted" title={kindTitle}>
          {kind}
        </span>
      )}
    </>
  )
}

function IncidentFacts({ incident }: { readonly incident: IncidentRow }) {
  return (
    <dl class="facts">
      {incident.rootCause !== undefined && (
        <Fact label="Root cause">
          <code class="facts__code">{incident.rootCause}</code>
        </Fact>
      )}
      {incident.rootCause?.includes(incident.message) !== true && (
        <Fact label="Message">{incident.message}</Fact>
      )}
      {incident.inCalledInstance !== undefined && (
        <Fact label="Located in">
          <CalledInstanceLink link={incident.inCalledInstance} />
        </Fact>
      )}
      {incident.job !== undefined && (
        <Fact label="Job">
          <IdWithKind
            {...incident.job}
            label="job ID"
            kind={incident.job.type}
            kindTitle="Job type"
          />
        </Fact>
      )}
      {incident.retriesLeft !== undefined && (
        <Fact label="Retries left">{incident.retriesLeft}</Fact>
      )}
      <IncidentModelFacts model={incident.model} />
      <Fact label="Incident">
        <IdText id={incident.id} shortId={incident.shortId} label="incident ID" />
      </Fact>
    </dl>
  )
}

function RetryButton({ incident }: { readonly incident: IncidentRow }) {
  const host = useHost()
  const write = useWriteState()
  const busy =
    WriteStates.on(write, { kind: "incident", incidentId: incident.id })?.status === "pending"
  const where = incident.inCalledInstance?.bpmnProcessId
  const label = busy ? "Retrying…" : where === undefined ? "Retry" : `Retry in ${where}`
  return (
    <button
      type="button"
      class="button button--secondary"
      disabled={WriteStates.isWriting(write)}
      onClick={() => {
        host.post({ type: "retryIncident", incidentId: incident.id })
      }}
    >
      <Icon of={busy ? glyphs.LoaderCircle : glyphs.RotateCcw} class={busy ? "spin" : undefined} />
      {label}
    </button>
  )
}

function IncidentCard({
  incident,
  elementName,
}: {
  readonly incident: IncidentRow
  readonly elementName: string
}) {
  const host = useHost()
  return (
    <article class="incident-card" aria-label={`${incident.typeLabel} at ${elementName}`}>
      <header class="incident-card__header">
        <StateLabel state="Incident" text={`${incident.typeLabel} · ${elementName}`} />
        <span class="muted" title={TimeLabels.tooltip(incident.createdAt)}>
          since {TimeLabels.clock(incident.createdAt)} ({TimeLabels.relative(incident.createdAt)})
        </span>
      </header>
      <IncidentFacts incident={incident} />
      <div class="incident-card__actions">
        {incident.detailsLabel !== undefined && (
          <button
            type="button"
            class="button button--secondary"
            onClick={() => {
              host.post({ type: "openIncidentDetails", incidentId: incident.id })
            }}
          >
            <Icon of={glyphs.FileText} />
            {incident.detailsLabel}
          </button>
        )}
        <IncidentModelActions incident={incident} />
        {incident.retryable === true && <RetryButton incident={incident} />}
      </div>
    </article>
  )
}

export function IncidentsTab({ incidents, elementName }: IncidentsTabProps) {
  if (incidents.length === 0) {
    return <EmptyHint text="No open incidents on this instance." />
  }
  return (
    <div class="incident-list">
      {incidents.map((incident) => (
        <IncidentCard
          key={incident.id}
          incident={incident}
          elementName={elementName(incident.elementId)}
        />
      ))}
    </div>
  )
}
