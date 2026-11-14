import { CircleXIcon } from "lucide-react"
import {
  Icon,
  SITUATION_TONES,
  StateLabel as KitStateLabel,
  TONE_ICON,
  cn,
  type StateLabelState,
} from "@miragon/pulse-ui"
import type { InstanceStateLabel } from "../../core/protocol/index.js"

type StateKind = InstanceStateLabel | "Incident"

const KIT_STATES: Readonly<Record<StateKind, StateLabelState>> = {
  Running: "running",
  Suspended: "suspended",
  Completed: "completed",
  Cancelled: "cancelled",
  Incident: "incident",
}

export interface StateLabelProps {
  readonly state: StateKind
  readonly text?: string
}

export function StateLabel({ state, text = state }: StateLabelProps) {
  return <KitStateLabel state={KIT_STATES[state]}>{text}</KitStateLabel>
}

export function IncidentFlag() {
  const tone = SITUATION_TONES.openIncident
  return (
    <span
      className="text-dense inline-flex min-w-0 items-baseline gap-1.5"
      data-part="incident-flag"
      data-tone={tone}
      title="Has an open incident"
    >
      <Icon icon={CircleXIcon} className={cn(TONE_ICON[tone], "self-center")} />
      <span className="text-foreground min-w-0 truncate">Incident</span>
    </span>
  )
}
