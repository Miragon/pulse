import { FunnelIcon } from "lucide-react"
import { useLayoutEffect, useMemo, useRef, useState, type Ref } from "react"
import {
  Button,
  ConditionChip,
  Icon,
  LocaleProvider,
  useLocale,
  type UiMessagesOverride,
} from "@miragon/pulse-ui"
import {
  VariableConditionTypes,
  type InstanceListFilterData,
  type VariableConditionData,
  type VariableConditionKindCode,
  type VariableOperatorCode,
  type VariableValueTypeCode,
} from "@miragon/pulse-screens"
import { useProcessWords, type ProcessWords } from "../../messages/process-words.js"
import { InstanceFilters } from "./instance-filters.js"
import { VariableConditionDialog } from "./variable-condition-dialog.js"

/** What the variable chips take beside the filter: the words, names and kinds a surface knows. */
export interface VariableFilterProps {
  /**
   * The words each condition shows on its chip, where the surface has its own; a condition without
   * is worded by the block as the editors' core words it (`route = "review"`, `amount > 100`).
   */
  readonly labels?: readonly string[] | undefined
  /** The names the engine knows for the process's variables, offered in the dialog. */
  readonly names?: readonly string[] | undefined
  /** The kinds of condition the engine refuses, which the dialog offers disabled with a reason. */
  readonly refused?: readonly VariableConditionKindCode[] | undefined
  /** The dialog opens: the surface may read the variable names now. */
  readonly onSuggest?: (() => void) | undefined
}

interface VariableChipsProps extends VariableFilterProps {
  readonly filter: InstanceListFilterData
  readonly onFilter: (filter: InstanceListFilterData) => void
}

interface Editing {
  readonly at?: number
}

interface FilterOpenerProps {
  readonly buttonRef: Ref<HTMLButtonElement>
  readonly active: number
  readonly onOpen: (opener: HTMLElement) => void
}

function FilterOpener({ buttonRef, active, onOpen }: FilterOpenerProps) {
  const t = useProcessWords()
  const name = active === 0 ? t("variables.filter") : t("variables.filterCount", { count: active })
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

/** The focus goes back to the control that opened the dialog, else to the opener. */
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

const SYMBOLS: Readonly<Record<Exclude<VariableOperatorCode, "like">, string>> = {
  equals: "=",
  notEquals: "≠",
  greaterThan: ">",
  lessThan: "<",
}

/** A value as it compares: text in quotes, a date with a space for its `T`, null as the word. */
function shownValue(type: VariableValueTypeCode, value: string): string {
  switch (type) {
    case "text":
      return JSON.stringify(value)
    case "date":
      return value.replace("T", " ")
    case "null":
      return "null"
    case "number":
    case "boolean":
      return value
  }
}

/**
 * A condition on its chip: its name, its operator as a symbol (_matches_ in the reader's
 * language) and its value as it compares (text in quotes), so two conditions on one variable
 * read apart.
 */
function labelOf(t: ProcessWords, condition: VariableConditionData): string {
  const { name, operator, value } = condition
  const symbol = operator === "like" ? t("operator.like") : SYMBOLS[operator]
  return `${name} ${symbol} ${shownValue(VariableConditionTypes.of(condition), value)}`
}

function chipWordsOf(t: ProcessWords): UiMessagesOverride {
  return {
    conditionChip: {
      edit: ({ label }) => t("condition.edit", { label }),
      remove: ({ label }) => t("condition.remove", { label }),
    },
  }
}

/**
 * The variable conditions of an instance list: a button that opens the dialog to add one, with how
 * many hold, and a chip per condition that edits it or removes it. The filter is asked for through
 * `onFilter`; the dialog closes on Apply, and the focus returns to what opened it.
 */
export function VariableChips(props: VariableChipsProps) {
  const { filter, labels, names, refused, onSuggest, onFilter } = props
  const t = useProcessWords()
  const locale = useLocale()
  const chipWords = useMemo(() => chipWordsOf(t), [t])
  const [editing, setEditing] = useState<Editing | undefined>(undefined)
  const { opener, returnFocusTo } = useReturnFocus(editing)
  const conditions = filter.variables ?? []
  const open = (from: HTMLElement, at?: number): void => {
    returnFocusTo(from)
    onSuggest?.()
    setEditing(at === undefined ? {} : { at })
  }
  const close = (): void => {
    setEditing(undefined)
  }
  return (
    <>
      <FilterOpener buttonRef={opener} active={conditions.length} onOpen={open} />
      <LocaleProvider locale={locale} uiMessages={chipWords}>
        {conditions.map((condition, at) => (
          <ConditionChip
            key={at}
            label={labels?.[at] ?? labelOf(t, condition)}
            opener={opener}
            onEdit={(button) => {
              open(button, at)
            }}
            onRemove={() => {
              onFilter(InstanceFilters.withoutVariable(filter, at))
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
            onFilter(InstanceFilters.withVariable(filter, condition, editing.at))
            close()
          }}
          onClose={close}
        />
      )}
    </>
  )
}
