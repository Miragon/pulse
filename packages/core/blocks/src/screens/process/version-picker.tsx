import { useState } from "react"
import { NativeSelect, formatCount } from "@miragon/pulse-ui"
import type { DefinitionRefData } from "@miragon/pulse-screens"
import { useProcessWords, type ProcessWords } from "../../messages/process-words.js"

/** A version of a process to pick, with its running instances and those with incident. */
export interface VersionOptionData {
  readonly definition: Pick<DefinitionRefData, "id" | "version">
  readonly running: number
  readonly withIncident: number
}

export interface VersionPickerProps {
  /** The versions as the engine lists them, the latest first (the process screen's `versions`). */
  readonly versions: readonly VersionOptionData[]
  /** The definition id of the version shown; none before one is picked. */
  readonly selected: string | undefined
  /** The picker's name; the blocks' "Version" without it. */
  readonly label?: string
  /** What the picker says before a version is picked. */
  readonly placeholder?: string
  /** A pick: the definition id of the version asked for. */
  readonly onPick: (definitionId: string) => void
}

interface Pending {
  readonly from: string | undefined
  readonly to: string
}

/** What the picker shows: a pick until the surface's `selected` changes, then `selected`. */
function useShownPick(selected: string | undefined) {
  const [pending, setPending] = useState<Pending | undefined>(undefined)
  const held = pending !== undefined && pending.from === selected
  if (pending !== undefined && !held) {
    setPending(undefined)
  }
  const hold = (to: string): void => {
    setPending({ from: selected, to })
  }
  return [held ? pending.to : selected, hold] as const
}

function optionOf(t: ProcessWords, { definition, running, withIncident }: VersionOptionData) {
  const counts = {
    version: definition.version,
    running: formatCount(running),
    withIncident: formatCount(withIncident),
  }
  return t(withIncident > 0 ? "version.optionWithIncident" : "version.option", counts)
}

/**
 * The versions of a process to pick from, each with its running instances and, where there are,
 * its instances with incident. A pick shows at once and asks for the version through `onPick`.
 */
export function VersionPicker({
  versions,
  selected,
  label,
  placeholder,
  onPick,
}: VersionPickerProps) {
  const t = useProcessWords()
  const [shown, hold] = useShownPick(selected)
  return (
    <label className="flex min-w-0">
      <span className="sr-only">{label ?? t("version.label")}</span>
      <NativeSelect
        className="max-w-70 cursor-pointer truncate px-1.5 tabular-nums max-[760px]:max-w-42"
        value={shown ?? ""}
        onChange={(event) => {
          const definitionId = event.currentTarget.value
          if (definitionId !== "") {
            hold(definitionId)
            onPick(definitionId)
          }
        }}
      >
        {placeholder !== undefined && shown === undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {versions.map((option) => (
          <option key={option.definition.id} value={option.definition.id}>
            {optionOf(t, option)}
          </option>
        ))}
      </NativeSelect>
    </label>
  )
}
