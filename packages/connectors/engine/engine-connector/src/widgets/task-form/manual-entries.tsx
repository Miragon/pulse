import type { Dispatch, SetStateAction } from "react"
import { Button, Icon, Input, NativeSelect } from "@miragon/pulse-ui"
import { X } from "lucide-react"

import { useT } from "../../messages/use-t.js"
import type { ManualEntry } from "./values.js"

const TYPE_OPTIONS = ["String", "Boolean", "Long", "Double", "Date", "Json"]

function ManualEntryRow({
  entry,
  onChange,
  onRemove,
}: {
  entry: ManualEntry
  onChange: (updated: ManualEntry) => void
  onRemove: () => void
}) {
  const t = useT()
  return (
    <div className="flex items-center gap-1">
      <Input
        aria-label={t("taskForm.variableName")}
        className="flex-1"
        placeholder={t("taskForm.namePlaceholder")}
        value={entry.name}
        onChange={(e) => onChange({ ...entry, name: e.target.value })}
      />
      <NativeSelect
        aria-label={t("taskForm.variableType")}
        value={entry.type}
        onChange={(e) => onChange({ ...entry, type: e.target.value })}
      >
        {TYPE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </NativeSelect>
      <Input
        aria-label={t("taskForm.variableValue")}
        className="flex-1"
        placeholder={t("taskForm.valuePlaceholder")}
        value={entry.value}
        onChange={(e) => onChange({ ...entry, value: e.target.value })}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t("taskForm.removeVariable")}
        onClick={onRemove}
      >
        <Icon icon={X} />
      </Button>
    </div>
  )
}

/** The variables added by hand, each to change or remove. */
export function ManualEntries({
  entries,
  setEntries,
}: {
  entries: ManualEntry[]
  setEntries: Dispatch<SetStateAction<ManualEntry[]>>
}) {
  return (
    <>
      {entries.map((entry) => (
        <ManualEntryRow
          key={entry.id}
          entry={entry}
          onChange={(updated) =>
            setEntries((prev) => prev.map((e) => (e.id === entry.id ? updated : e)))
          }
          onRemove={() => setEntries((prev) => prev.filter((e) => e.id !== entry.id))}
        />
      ))}
    </>
  )
}
