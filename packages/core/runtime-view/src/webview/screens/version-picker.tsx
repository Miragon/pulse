import type { VersionOption } from "../../core/protocol/index.js"
import { usePendingValue } from "../components/pending-value.js"
import { useHost } from "../host/host-context.js"
import { VersionOptionLabel } from "./version-option-label.js"

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
  label = "Version",
  placeholder,
  onPick,
}: VersionPickerProps) {
  const host = useHost()
  const [shown, hold] = usePendingValue(selected)
  const post =
    onPick ??
    ((definitionId: string) => {
      host.post({ type: "selectVersion", definitionId })
    })
  const pick = (definitionId: string): void => {
    hold(definitionId)
    post(definitionId)
  }
  return (
    <label class="version-picker">
      <span class="visually-hidden">{label}</span>
      <select
        class="version-picker__select"
        value={shown ?? ""}
        onChange={(event) => {
          if (event.currentTarget.value !== "") {
            pick(event.currentTarget.value)
          }
        }}
      >
        {placeholder !== undefined && shown === undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {versions.map((option) => (
          <option key={option.definitionId} value={option.definitionId}>
            {VersionOptionLabel.of(option)}
          </option>
        ))}
      </select>
    </label>
  )
}
