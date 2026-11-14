import {
  cn,
  ConditionChip,
  LocaleProvider,
  useLocale,
  type UiMessagesOverride,
} from "@miragon/pulse-ui"
import type { InstanceListFilter } from "../../core/protocol/index.js"
import { InstanceFilter } from "./instance-filter.js"

export interface ElementChipProps {
  readonly filter: InstanceListFilter
  readonly elementName: (elementId: string) => string
  readonly onFilter: (filter: InstanceListFilter) => void
  readonly className: string
}

class ElementChipWords {
  static readonly CLEAR: UiMessagesOverride = {
    conditionChip: { remove: () => "Clear element filter" },
  }
}

export function ElementChip({ filter, elementName, onFilter, className }: ElementChipProps) {
  const locale = useLocale()
  if (filter.elementId === undefined) {
    return null
  }
  return (
    <span
      className={cn("flex max-w-60 min-w-0 shrink-0", className)}
      data-part="filter-chip"
      data-kind="element"
    >
      <LocaleProvider locale={locale} uiMessages={ElementChipWords.CLEAR}>
        <ConditionChip
          prefix="At"
          label={elementName(filter.elementId)}
          className="max-w-full"
          onRemove={() => {
            onFilter(InstanceFilter.withoutElement(filter))
          }}
        />
      </LocaleProvider>
    </span>
  )
}
