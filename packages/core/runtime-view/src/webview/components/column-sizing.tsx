import { useRef, useState } from "preact/hooks"
import { useHost } from "../host/host-context.js"
import { UiStateStore } from "../host/ui-state-store.js"
import { ColumnMeasure, type ColumnWidths } from "./column-measure.js"
import { Separator } from "./separator.js"

const STEP = 8
const SHIFT_STEP = 32

export interface ColumnSizing {
  readonly widths: ColumnWidths | undefined
  readonly resize: (cell: Element, key: string, width: number, persist: boolean) => void
  readonly persist: () => void
}

export function useColumnSizing(
  tableId: string | undefined,
  keys: readonly string[],
): ColumnSizing {
  const { api } = useHost()
  const [widths, setWidths] = useState(() =>
    tableId === undefined ? undefined : UiStateStore.columnWidths(api, tableId, keys),
  )
  const save = (next: ColumnWidths | undefined): void => {
    if (tableId !== undefined && next !== undefined) {
      UiStateStore.writeColumnWidths(api, tableId, next)
    }
  }
  return {
    widths,
    resize: (cell, key, width, persist) => {
      const next = {
        ...(widths ?? ColumnMeasure.widths(cell, keys)),
        [key]: ColumnMeasure.clamp(cell, width),
      }
      setWidths(next)
      if (persist) {
        save(next)
      }
    },
    persist: () => {
      save(widths)
    },
  }
}

export interface ColumnGripProps {
  readonly label: string
  readonly columnKey: string
  readonly sizing: ColumnSizing
}

export function ColumnGrip({ label, columnKey, sizing }: ColumnGripProps) {
  const drag = useRef({ x: 0, width: 0, cell: null as Element | null })
  const [focused, setFocused] = useState<number | undefined>(undefined)
  const width = sizing.widths?.[columnKey] ?? focused
  const cellOf = (event: Event): Element =>
    (event.currentTarget as Element).parentElement as Element
  const set = (cell: Element, next: number, persist = true): void => {
    sizing.resize(cell, columnKey, next, persist)
  }
  const step = (sign: number) => (event: KeyboardEvent) => {
    const cell = cellOf(event)
    set(cell, ColumnMeasure.width(cell) + sign * (event.shiftKey ? SHIFT_STEP : STEP))
  }
  const fit = (event: Event): void => {
    set(cellOf(event), ColumnMeasure.fit(cellOf(event)))
  }
  return (
    <Separator
      class="column-grip"
      orientation="vertical"
      label={`Resize column ${label}`}
      value={width}
      min={ColumnMeasure.MIN}
      max={ColumnMeasure.MAX}
      valueText={width === undefined ? undefined : `${width} pixels`}
      keys={{
        ArrowLeft: step(-1),
        ArrowRight: step(1),
        Enter: fit,
        Home: (event) => {
          set(cellOf(event), 0)
        },
      }}
      onFocus={(event) => {
        setFocused(ColumnMeasure.width(cellOf(event)))
      }}
      onDragStart={(event) => {
        const cell = cellOf(event)
        drag.current = { x: event.clientX, width: ColumnMeasure.width(cell), cell }
        set(cell, drag.current.width, false)
      }}
      onDrag={(event) => {
        set(cellOf(event), drag.current.width + event.clientX - drag.current.x, false)
      }}
      onDragEnd={sizing.persist}
      onDragCancel={() => {
        if (drag.current.cell !== null) {
          set(drag.current.cell, drag.current.width)
        }
      }}
      onDoubleClick={fit}
    />
  )
}
