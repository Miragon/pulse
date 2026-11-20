import { useMemo } from "react"
import {
  ConditionChip,
  LocaleProvider,
  cn,
  useLocale,
  type UiMessagesOverride,
} from "@miragon/pulse-ui"
import type { InstanceListFilterData } from "@miragon/pulse-screens"
import { useProcessWords } from "../../messages/process-words.js"
import { InstanceFilters } from "./instance-filters.js"

interface ElementChipProps {
  readonly filter: InstanceListFilterData
  readonly elementName: (elementId: string) => string
  readonly onFilter: (filter: InstanceListFilterData) => void
  readonly className?: string
}

/** The chip of the element a list is filtered to ("At Check credit"), which clears that filter. */
export function ElementChip({ filter, elementName, onFilter, className }: ElementChipProps) {
  const t = useProcessWords()
  const locale = useLocale()
  const words = useMemo<UiMessagesOverride>(
    () => ({ conditionChip: { remove: () => t("element.clear") } }),
    [t],
  )
  if (filter.elementId === undefined) {
    return null
  }
  return (
    <span
      className={cn("flex max-w-60 min-w-0 shrink-0", className)}
      data-part="filter-chip"
      data-kind="element"
    >
      <LocaleProvider locale={locale} uiMessages={words}>
        <ConditionChip
          prefix={t("element.prefix")}
          label={elementName(filter.elementId)}
          className="max-w-full"
          onRemove={() => {
            onFilter(InstanceFilters.withoutElement(filter))
          }}
        />
      </LocaleProvider>
    </span>
  )
}
