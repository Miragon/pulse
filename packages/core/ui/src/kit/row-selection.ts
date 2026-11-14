import { Checkbox } from "../primitives/checkbox.js"
import type { DataTableSelection } from "./data-table-types.js"

/**
 * A `DataTable`'s selection column from the caller's state and callbacks, with the kit's
 * `Checkbox` as each row's box and the head's: the table takes the box from here, so a table
 * without a selection column never loads it.
 *
 * Inside the table's props the table's own `Row` is still being inferred, so name it at the call:
 * `selection={rowSelection<Order>({ isSelected, onToggle, all, onToggleAll, rowLabel })}`.
 */
export function rowSelection<Row>(
  selection: Omit<DataTableSelection<Row>, "Box">,
): DataTableSelection<Row> {
  return { ...selection, Box: Checkbox }
}
