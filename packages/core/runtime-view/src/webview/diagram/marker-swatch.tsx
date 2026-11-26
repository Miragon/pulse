import type { MarkerSwatchProps } from "@miragon/pulse-blocks"
import { cn } from "@miragon/pulse-ui"

const SIGNS: Readonly<Record<MarkerSwatchProps["kind"], string>> = {
  waiting: "waiting",
  incident: "incident",
  incidentInCalledInstance: "called",
  completed: "completed",
}

export function MarkerSwatch({ kind }: MarkerSwatchProps) {
  return (
    <span className={cn("legend-swatch", `legend-swatch--${SIGNS[kind]}`)} aria-hidden="true" />
  )
}
