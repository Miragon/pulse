import { Checkbox } from "@miragon/pulse-ui"
import type { ReactNode } from "react"

export interface MappingBarProps {
  readonly showAll: boolean
  readonly onShowAll: (shown: boolean) => void
  readonly linked: boolean
  readonly onLinked: (linked: boolean) => void
  readonly hint: string
}

function Toggle({
  checked,
  onChange,
  children,
}: {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly children: ReactNode
}) {
  return (
    <label className="inline-flex min-h-6 cursor-pointer items-center gap-2 whitespace-nowrap">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => {
          onChange(value === true)
        }}
      />
      {children}
    </label>
  )
}

export function MappingBar({ showAll, onShowAll, linked, onLinked, hint }: MappingBarProps) {
  return (
    <div
      className="bg-card border-border px-gutter flex flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t pt-1 pb-5"
      role="group"
      aria-label="Mapping view"
      data-part="mapping-bar"
    >
      <Toggle checked={showAll} onChange={onShowAll}>
        Show all mappings
      </Toggle>
      <Toggle checked={linked} onChange={onLinked}>
        Pan and zoom together
      </Toggle>
      <span className="text-muted-foreground min-w-0" aria-live="polite" data-part="mapping-hint">
        {hint}
      </span>
    </div>
  )
}
