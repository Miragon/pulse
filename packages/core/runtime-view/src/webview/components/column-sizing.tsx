import { useColumnSizing as useKitColumnSizing, type ColumnSizing } from "@miragon/pulse-ui"
import { useHost } from "../host/host-context.js"
import { UiStateStore } from "../host/ui-state-store.js"
import { ColumnMeasure } from "./column-measure.js"

export type { ColumnSizing } from "@miragon/pulse-ui"

export function useColumnSizing(
  tableId: string | undefined,
  keys: readonly string[],
): ColumnSizing {
  const { api } = useHost()
  return useKitColumnSizing({
    min: ColumnMeasure.MIN,
    load: () => (tableId === undefined ? undefined : UiStateStore.columnWidths(api, tableId, keys)),
    save: (widths) => {
      if (tableId !== undefined) {
        UiStateStore.writeColumnWidths(api, tableId, widths ?? {})
      }
    },
  })
}
