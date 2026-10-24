import { glyphs } from "./lucide-glyphs.json"
import type { InstanceStateLabel } from "../../core/protocol/index.js"
import { Icon } from "./icon.js"

type StateKind = InstanceStateLabel | "Incident"

const GLYPHS: Readonly<Record<StateKind, string>> = {
  Running: glyphs.CircleDot,
  Suspended: glyphs.Pause,
  Completed: glyphs.CircleCheck,
  Terminated: glyphs.Ban,
  Incident: glyphs.CircleX,
}

const TONES: Readonly<Record<StateKind, string>> = {
  Running: "running",
  Suspended: "neutral",
  Completed: "neutral",
  Terminated: "neutral",
  Incident: "danger",
}

export interface StateLabelProps {
  readonly state: StateKind
  readonly text?: string
}

export function StateLabel({ state, text = state }: StateLabelProps) {
  return (
    <span class={`state-label state-label--${TONES[state]}`} title={text}>
      <Icon of={GLYPHS[state]} />
      <span class="state-label__text">{text}</span>
    </span>
  )
}

export function IncidentFlag() {
  return (
    <span class="state-label state-label--danger incident-flag" title="Has an open incident">
      <Icon of={glyphs.CircleX} />
      <span class="state-label__text">Incident</span>
    </span>
  )
}
