import { IncidentCard } from "@miragon/pulse-blocks"
import { FileTextIcon, LoaderCircleIcon, RotateCcwIcon } from "lucide-react"
import type { IncidentRow } from "../../core/protocol/index.js"
import { EmptyHint } from "../components/empty-hint.js"
import { Button, cn, Icon } from "@miragon/pulse-ui"
import { useHost } from "../host/host-context.js"
import { useWriteState } from "../host/write-context.js"
import { WriteStates } from "../host/write-states.js"
import { IncidentModel, IncidentModelActions } from "./incident-model.js"
import { InstanceForms } from "./instance-forms.js"
import { useInstanceSlots } from "./instance-slots.js"

export interface IncidentsTabProps {
  readonly engine: string
  readonly incidents: readonly IncidentRow[]
  readonly elementName: (elementId: string) => string
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

function DetailsButton({ incident }: { readonly incident: IncidentRow }) {
  const host = useHost()
  if (incident.detailsLabel === undefined) {
    return null
  }
  return (
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
  )
}

export function IncidentsTab({ engine, incidents, elementName }: IncidentsTabProps) {
  const slots = useInstanceSlots()
  if (incidents.length === 0) {
    return <EmptyHint text="No open incidents on this instance." />
  }
  return (
    <div className="flex flex-col gap-3 p-3">
      {incidents.map((incident) => (
        <IncidentCard
          key={incident.id}
          engine={engine}
          card={InstanceForms.incident(incident)}
          elementName={elementName(incident.elementId)}
          facts={IncidentModel.facts(incident.model)}
          detail={<DetailsButton incident={incident} />}
          actions={
            <>
              <IncidentModelActions incident={incident} />
              {incident.retryable === true && <RetryButton incident={incident} />}
            </>
          }
          slots={slots}
        />
      ))}
    </div>
  )
}
