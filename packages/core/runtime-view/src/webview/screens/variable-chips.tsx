import { FunnelIcon } from "lucide-react"
import { useLayoutEffect, useRef, useState, type Ref } from "react"
import {
  Button,
  ConditionChip,
  Icon,
  LocaleProvider,
  useLocale,
  type UiMessagesOverride,
} from "@miragon/pulse-ui"
import type { InstanceListFilter, RefusedVariableCondition } from "../../core/protocol/index.js"
import { useHost } from "../host/host-context.js"
import { InstanceFilter } from "./instance-filter.js"
import { VariableConditionDialog } from "./variable-condition-dialog.js"

export interface VariableChipsProps {
  readonly filter: InstanceListFilter
  readonly labels: readonly string[] | undefined
  readonly names: readonly string[] | undefined
  readonly refused?: readonly RefusedVariableCondition[] | undefined
  readonly onFilter: (filter: InstanceListFilter) => void
}

interface Editing {
  readonly at?: number
}

class ChipWords {
  static readonly CONDITION: UiMessagesOverride = {
    conditionChip: {
      edit: ({ label }) => `Edit condition ${label}`,
      remove: ({ label }) => `Remove condition ${label}`,
    },
  }
}

interface FilterOpenerProps {
  readonly buttonRef: Ref<HTMLButtonElement>
  readonly active: number
  readonly onOpen: (opener: HTMLElement) => void
}

function FilterOpener({ buttonRef, active, onOpen }: FilterOpenerProps) {
  const name = active === 0 ? "Filter by variables" : `Filter by variables, ${active} active`
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="outline"
      size="sm"
      className="tabular-nums"
      aria-haspopup="dialog"
      aria-label={name}
      title={name}
      onClick={(event) => {
        onOpen(event.currentTarget)
      }}
    >
      <Icon icon={FunnelIcon} />
      {active > 0 && <span aria-hidden="true">{active}</span>}
    </Button>
  )
}

function useReturnFocus(editing: Editing | undefined) {
  const opener = useRef<HTMLButtonElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const target = returnTo.current
    if (target !== null && editing === undefined) {
      returnTo.current = null
      const focusable = target.isConnected ? target : opener.current
      focusable?.focus()
    }
  }, [editing])
  const returnFocusTo = (target: HTMLElement): void => {
    returnTo.current = target
  }
  return { opener, returnFocusTo }
}

export function VariableChips({ filter, labels, names, refused, onFilter }: VariableChipsProps) {
  const host = useHost()
  const locale = useLocale()
  const [editing, setEditing] = useState<Editing | undefined>(undefined)
  const { opener, returnFocusTo } = useReturnFocus(editing)
  const conditions = filter.variables ?? []
  const open = (from: HTMLElement, at?: number): void => {
    returnFocusTo(from)
    host.post({ type: "suggestVariableNames" })
    setEditing(at === undefined ? {} : { at })
  }
  const close = (): void => {
    setEditing(undefined)
  }
  return (
    <>
      <FilterOpener buttonRef={opener} active={conditions.length} onOpen={open} />
      <LocaleProvider locale={locale} uiMessages={ChipWords.CONDITION}>
        {conditions.map((condition, at) => (
          <ConditionChip
            key={at}
            label={labels?.[at] ?? condition.name}
            opener={opener}
            onEdit={(button) => {
              open(button, at)
            }}
            onRemove={() => {
              onFilter(InstanceFilter.withoutVariable(filter, at))
            }}
          />
        ))}
      </LocaleProvider>
      {editing !== undefined && (
        <VariableConditionDialog
          initial={editing.at === undefined ? undefined : conditions[editing.at]}
          others={editing.at === undefined ? conditions.length : conditions.length - 1}
          suggestions={names ?? []}
          refused={refused ?? []}
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
