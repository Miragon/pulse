import { SITUATION_TONES, type Situation } from "@miragon/pulse-ui/tones"
import { glyphs } from "./lucide-glyphs.json"
import type { InstanceStateLabel } from "../../core/protocol/index.js"
import { Icon } from "./icon.js"

type StateKind = InstanceStateLabel | "Incident"

const GLYPHS: Readonly<Record<StateKind, string>> = {
  Running: glyphs.CircleDot,
  Suspended: glyphs.Pause,
  Completed: glyphs.CircleCheck,
  Cancelled: glyphs.Ban,
  Incident: glyphs.CircleX,
}

const SITUATIONS: Readonly<Record<StateKind, Situation>> = {
  Running: "running",
  Suspended: "suspended",
  Completed: "ended",
  Cancelled: "ended",
  Incident: "openIncident",
}

export interface StateLabelProps {
  readonly state: StateKind
  readonly text?: string
}

export function StateLabel({ state, text = state }: StateLabelProps) {
  return (
    <span class={`state-label state-label--${SITUATION_TONES[SITUATIONS[state]]}`} title={text}>
      <Icon of={GLYPHS[state]} />
      <span class="state-label__text">{text}</span>
    </span>
  )
}

export function IncidentFlag() {
  return (
    <span
      class={`state-label state-label--${SITUATION_TONES.openIncident} incident-flag`}
      title="Has an open incident"
    >
      <Icon of={glyphs.CircleX} />
      <span class="state-label__text">Incident</span>
    </span>
  )
}
