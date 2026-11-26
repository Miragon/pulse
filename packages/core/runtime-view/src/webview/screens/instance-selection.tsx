import type { InstanceSelectSlot } from "@miragon/pulse-blocks"
import { Checkbox } from "@miragon/pulse-ui"
import type { ReactNode } from "react"
import { usePendingValue } from "../components/pending-value.js"
import { useHost } from "../host/host-context.js"
import type { ListedInstance } from "./listed-instance.js"

const SELECTION_WIDTH = 32

const SELECTION_CELL =
  "[td:has(>&)]:p-0 [th:has(>&)]:p-0 flex h-row cursor-pointer items-center pl-(--cell-px)"

function SelectionLabel({ children }: { readonly children: ReactNode }) {
  return (
    <label
      className={SELECTION_CELL}
      onClick={(event) => {
        event.stopPropagation()
      }}
    >
      {children}
    </label>
  )
}

function SelectionHeader({
  rows,
  selected,
}: {
  readonly rows: readonly ListedInstance[]
  readonly selected: number
}) {
  const host = useHost()
  const selectable = rows.filter((row) => row.selectable === true)
  const shown = selectable.filter((row) => row.selected === true).length
  const all = shown > 0 && shown === selectable.length
  const [checked, hold] = usePendingValue(all)
  const mixed = shown > 0 && !all && checked === all
  return (
    <SelectionLabel>
      <Checkbox
        aria-label="Select all shown instances"
        checked={mixed ? "indeterminate" : checked}
        onCheckedChange={() => {
          hold(!all)
          host.post(
            all && selected > shown
              ? { type: "clearSelection" }
              : { type: "toggleInstances", ids: selectable.map((row) => row.id), selected: !all },
          )
        }}
      />
    </SelectionLabel>
  )
}

function SelectionCell({ row }: { readonly row: ListedInstance }) {
  const host = useHost()
  const [checked, hold] = usePendingValue(row.selected === true)
  if (row.selectable !== true) {
    return null
  }
  return (
    <SelectionLabel>
      <Checkbox
        tabIndex={-1}
        aria-label={`Select ${row.businessKey ?? row.shortId}`}
        checked={checked}
        onCheckedChange={() => {
          hold(!checked)
          host.post({ type: "toggleInstances", ids: [row.id], selected: !checked })
        }}
      />
    </SelectionLabel>
  )
}

export function useInstanceSelection(
  rows: readonly ListedInstance[],
  selected: number,
): InstanceSelectSlot<ListedInstance> | undefined {
  const host = useHost()
  if (!rows.some((row) => row.selectable === true)) {
    return undefined
  }
  return {
    column: {
      key: "select",
      label: "Select",
      width: SELECTION_WIDTH,
      header: <SelectionHeader rows={rows} selected={selected} />,
      cell: (row) => <SelectionCell row={row} />,
    },
    onToggle: (row) => {
      if (row.selectable === true) {
        host.post({ type: "toggleInstances", ids: [row.id], selected: row.selected !== true })
      }
    },
  }
}
