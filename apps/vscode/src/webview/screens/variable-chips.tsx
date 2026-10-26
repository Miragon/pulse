import { useEffect, useRef, useState } from "preact/hooks"
import type { InstanceListFilter } from "../../core/protocol/index.js"
import { Icon } from "../components/icon.js"
import { glyphs } from "../components/lucide-glyphs.json"
import { InstanceFilter } from "./instance-filter.js"
import { VariableConditionDialog } from "./variable-condition-dialog.js"

export interface VariableChipsProps {
  readonly filter: InstanceListFilter
  readonly labels: readonly string[] | undefined
  readonly onFilter: (filter: InstanceListFilter) => void
}

interface Editing {
  readonly at?: number
}

interface VariableChipProps {
  readonly label: string
  readonly onEdit: () => void
  readonly onRemove: () => void
}

function VariableChip({ label, onEdit, onRemove }: VariableChipProps) {
  return (
    <span class="filter-chip filter-chip--variable" title={label}>
      <button
        type="button"
        class="filter-chip__name filter-chip__edit"
        aria-label={`Edit condition ${label}`}
        aria-haspopup="dialog"
        onClick={onEdit}
      >
        {label}
      </button>
      <button
        type="button"
        class="icon-button icon-button--small"
        aria-label={`Remove condition ${label}`}
        onClick={onRemove}
      >
        <Icon of={glyphs.X} />
      </button>
    </span>
  )
}

export function VariableChips({ filter, labels, onFilter }: VariableChipsProps) {
  const [editing, setEditing] = useState<Editing | undefined>(undefined)
  const opener = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  const conditions = filter.variables ?? []
  useEffect(() => {
    if (refocus.current && editing === undefined) {
      refocus.current = false
      opener.current?.focus()
    }
  }, [editing])
  const close = (): void => {
    refocus.current = true
    setEditing(undefined)
  }
  return (
    <>
      <button
        ref={opener}
        type="button"
        class="button button--secondary button--compact"
        aria-haspopup="dialog"
        onClick={() => {
          setEditing({})
        }}
      >
        {conditions.length === 0 ? "Variables" : `Variables · ${conditions.length}`}
      </button>
      {conditions.map((condition, at) => (
        <VariableChip
          key={`${at}:${condition.name}`}
          label={labels?.[at] ?? condition.name}
          onEdit={() => {
            setEditing({ at })
          }}
          onRemove={() => {
            onFilter(InstanceFilter.withoutVariable(filter, at))
            opener.current?.focus()
          }}
        />
      ))}
      {editing !== undefined && (
        <VariableConditionDialog
          initial={editing.at === undefined ? undefined : conditions[editing.at]}
          others={editing.at === undefined ? conditions.length : conditions.length - 1}
          onApply={(condition) => {
            onFilter(InstanceFilter.withVariable(filter, condition, editing.at))
            close()
          }}
          onClose={close}
        />
      )}
    </>
  )
}
