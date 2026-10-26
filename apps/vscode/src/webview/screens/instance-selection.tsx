import type { InstanceRow } from "../../core/protocol/index.js"
import type { ComponentChildren } from "preact"
import { useLayoutEffect, useRef } from "preact/hooks"
import type { Column } from "../components/data-table.js"
import { useHost } from "../host/host-context.js"

const SELECTION_WIDTH = 32

function SelectionLabel({ children }: { readonly children: ComponentChildren }) {
  return (
    <label
      class="selection-cell"
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
  const box = useRef<HTMLInputElement>(null)
  const selectable = rows.filter((row) => row.selectable === true)
  const shown = selectable.filter((row) => row.selected === true).length
  const all = shown > 0 && shown === selectable.length
  useLayoutEffect(() => {
    if (box.current !== null) {
      box.current.indeterminate = shown > 0 && !all
    }
  }, [shown, all])
  return (
    <SelectionLabel>
      <input
        ref={box}
        type="checkbox"
        class="selection-box"
        aria-label="Select all shown instances"
        checked={all}
        onChange={() => {
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
  if (row.selectable !== true) {
    return null
  }
  return (
    <SelectionLabel>
      <input
        type="checkbox"
        class="selection-box"
        tabIndex={-1}
        aria-label={`Select ${row.businessKey ?? row.shortId}`}
        checked={row.selected === true}
        onChange={() => {
          host.post({ type: "toggleInstances", ids: [row.id], selected: row.selected !== true })
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
