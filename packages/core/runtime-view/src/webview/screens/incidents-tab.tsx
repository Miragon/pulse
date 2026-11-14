import { FileTextIcon, LoaderCircleIcon, RotateCcwIcon } from "lucide-react"
import type { IncidentRow } from "../../core/protocol/index.js"
import { EmptyHint } from "../components/empty-hint.js"
import { Button, cn, Facts, Icon, type Fact } from "@miragon/pulse-ui"
import { IdText } from "../components/id-text.js"
import { StateLabel } from "../components/state-label.js"
import { TimeLabels } from "../format/time-labels.js"
import { useHost } from "../host/host-context.js"
import { useWriteState } from "../host/write-context.js"
import { WriteStates } from "../host/write-states.js"
import { CalledInstanceLink } from "./called-instance-link.js"
import { IncidentModel, IncidentModelActions } from "./incident-model.js"

export interface IncidentsTabProps {
  readonly incidents: readonly IncidentRow[]
  readonly elementName: (elementId: string) => string
}

function JobValue({ job }: { readonly job: NonNullable<IncidentRow["job"]> }) {
  return (
    <>
      <IdText id={job.id} shortId={job.shortId} label="job ID" />
      {job.type !== undefined && (
        <span className="text-muted-foreground" title="Job type">
          {job.type}
        </span>
      )}
    </>
  )
}

class IncidentFacts {
  static of(incident: IncidentRow): readonly Fact[] {
    return [
      ...IncidentFacts.cause(incident),
      ...IncidentFacts.where(incident),
      ...IncidentModel.facts(incident.model),
      {
        label: "Incident",
        value: <IdText id={incident.id} shortId={incident.shortId} label="incident ID" />,
      },
    ]
  }

  private static cause(incident: IncidentRow): readonly Fact[] {
    const root: readonly Fact[] =
      incident.rootCause === undefined
        ? []
        : [{ label: "Root cause", value: incident.rootCause, mono: true, emphasis: true }]
    const message: readonly Fact[] =
      incident.rootCause?.includes(incident.message) === true
        ? []
        : [{ label: "Message", value: incident.message }]
    return [...root, ...message]
  }

  private static where(incident: IncidentRow): readonly Fact[] {
    const facts: Fact[] = []
    if (incident.inCalledInstance !== undefined) {
      facts.push({
        label: "Located in",
        value: <CalledInstanceLink link={incident.inCalledInstance} />,
      })
    }
    if (incident.job !== undefined) {
      facts.push({ label: "Job", value: <JobValue job={incident.job} /> })
    }
    if (incident.retriesLeft !== undefined) {
      facts.push({ label: "Retries left", value: incident.retriesLeft })
    }
    return facts
  }
}

function RetryButton({ incident }: { readonly incident: IncidentRow }) {
  const host = useHost()
  const write = useWriteState()
  const busy =
    WriteStates.on(write, { kind: "incident", incidentId: incident.id })?.status === "pending"
  const where = incident.inCalledInstance?.bpmnProcessId
  const label = busy ? "Retrying…" : where === undefined ? "Retry" : `Retry in ${where}`
  return (
    <Button
      type="button"
      variant="outline"
      disabled={WriteStates.isWriting(write)}
      onClick={() => {
        host.post({ type: "retryIncident", incidentId: incident.id })
      }}
    >
      <Icon
        icon={busy ? LoaderCircleIcon : RotateCcwIcon}
        className={cn(busy && "motion-safe:animate-spin")}
      />
      {label}
    </Button>
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
    <article
      className="border-border bg-card flex flex-col items-start gap-2.5 rounded-md border px-4 py-3"
      data-part="incident-card"
      aria-label={`${incident.typeLabel} at ${elementName}`}
    >
      <header className="flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-semibold">
        <StateLabel state="Incident" text={`${incident.typeLabel} · ${elementName}`} />
        <span
          className="text-muted-foreground font-normal tabular-nums"
          title={TimeLabels.tooltip(incident.createdAt)}
        >
          since {TimeLabels.clock(incident.createdAt)} ({TimeLabels.relative(incident.createdAt)})
        </span>
      </header>
      <Facts facts={IncidentFacts.of(incident)} />
      <div className="flex flex-wrap gap-2">
        {incident.detailsLabel !== undefined && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              host.post({ type: "openIncidentDetails", incidentId: incident.id })
            }}
          >
            <Icon icon={FileTextIcon} />
            {incident.detailsLabel}
          </Button>
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
    <div className="flex flex-col gap-3 p-3">
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
