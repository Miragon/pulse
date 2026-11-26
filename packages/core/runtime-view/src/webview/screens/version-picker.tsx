import { VersionPicker as PickerBlock } from "@miragon/pulse-blocks"
import type { VersionOption } from "../../core/protocol/index.js"
import { useHost } from "../host/host-context.js"

export interface VersionPickerProps {
  readonly versions: readonly VersionOption[]
  readonly selected: string | undefined
  readonly label?: string
  readonly placeholder?: string
  readonly onPick?: (definitionId: string) => void
}

export function VersionPicker({
  versions,
  selected,
  label,
  placeholder,
  onPick,
}: VersionPickerProps) {
  const host = useHost()
  return (
    <PickerBlock
      versions={versions.map(({ definitionId, version, running, withIncident }) => ({
        definition: { id: definitionId, version },
        running,
        withIncident,
      }))}
      selected={selected}
      {...(label === undefined ? {} : { label })}
      {...(placeholder === undefined ? {} : { placeholder })}
      onPick={
        onPick ??
        ((definitionId) => {
          host.post({ type: "selectVersion", definitionId })
        })
      }
    />
  )
}
