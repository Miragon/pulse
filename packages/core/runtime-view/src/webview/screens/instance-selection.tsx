import { Checkbox } from "@miragon/pulse-ui"
import type { ReactNode } from "react"
import type { InstanceRow } from "../../core/protocol/index.js"
import type { Column } from "../components/data-table.js"
import { usePendingValue } from "../components/pending-value.js"
import { useHost } from "../host/host-context.js"

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
  readonly rows: readonly InstanceRow[]
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

function SelectionCell({ row }: { readonly row: InstanceRow }) {
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

export function useSelectionColumn(
  rows: readonly InstanceRow[],
  selected: number,
): Column<InstanceRow> | undefined {
  if (!rows.some((row) => row.selectable === true)) {
    return undefined
  }
  return {
    key: "select",
    label: "Select",
    width: SELECTION_WIDTH,
    header: <SelectionHeader rows={rows} selected={selected} />,
    render: (row) => <SelectionCell row={row} />,
  }
}
