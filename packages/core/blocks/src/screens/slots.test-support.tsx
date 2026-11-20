import { DataTable, NamedId, TableEmptyState } from "@miragon/pulse-ui"
import type { ScreenTarget } from "@miragon/pulse-screens"
import type { KeyboardEvent } from "react"
import type { ScreenCopy, ScreenOpenHow, ScreenSlots, ScreenTableProps } from "./slots.js"

/** What the blocks asked of a surface: the targets they opened and the copies of its rows. */
export interface ScreenAsked {
  readonly opened: { readonly target: ScreenTarget; readonly how: ScreenOpenHow }[]
  readonly copied: ScreenCopy[]
}

/**
 * The editors' table, as the webview's slot builds it: pulse-ui's `DataTable` with drawn rows
 * that open on a click or Enter (Ctrl or Cmd beside the view), named by what they open, copied on
 * Ctrl or Cmd with C; it keeps every column, since the user sizes them, and links nowhere.
 */
function editorTable(asked: ScreenAsked) {
  return function EditorTable<Row>(props: ScreenTableProps<Row>) {
    const { name, label, columns, rows, rowKey, onOpen, rowLabel, copyOf, empty } = props
    const { emptyAction, footer, onToggle } = props
    return (
      <div
        data-testid="editor-table"
        data-name={name}
        onKeyDown={(event: KeyboardEvent) => {
          const row = event.target instanceof HTMLTableRowElement ? event.target : null
          const at = row === null ? -1 : row.sectionRowIndex
          const toggled = rows[at]
          if (event.key === " " && toggled !== undefined) onToggle?.(toggled)
        }}
      >
        <DataTable<Row>
          label={label}
          columns={columns.map((column) => ({
            key: column.key,
            name: column.label,
            label: column.header ?? column.label,
            cell: column.cell,
            ...(column.width === undefined ? {} : { width: column.width }),
          }))}
          rows={rows}
          rowKey={rowKey}
          onActivate={(row, how) => {
            onOpen(row, how)
          }}
          rowLabel={rowLabel}
          onCopy={(row) => {
            asked.copied.push(copyOf(row))
          }}
          empty={
            <p data-part="table-empty">
              {empty}
              {emptyAction !== undefined && (
                <button type="button" onClick={emptyAction.onClick}>
                  {emptyAction.label}
                </button>
              )}
            </p>
          }
          {...(footer === undefined ? {} : { footer })}
        />
      </div>
    )
  }
}

/**
 * A page's table, as the web app's slot over widget-shell's `ListTable` builds it: rows composed
 * by hand, each a link to what it opens where the page has addresses, a column that drops in a
 * narrow region marked for the region's container query, the empty state the kit's.
 */
function pageTable(asked: ScreenAsked) {
  return function PageTable<Row>(props: ScreenTableProps<Row>) {
    const { name, label, columns, rows, rowKey, onOpen, linkOf, rowLabel, copyOf, empty } = props
    const { emptyAction, footer } = props
    if (rows.length === 0) {
      return (
        <TableEmptyState>
          {empty}
          {emptyAction !== undefined && (
            <button type="button" onClick={emptyAction.onClick}>
              {emptyAction.label}
            </button>
          )}
        </TableEmptyState>
      )
    }
    return (
      <table aria-label={label} data-testid="page-table" data-name={name}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} data-hide-below={column.hideBelow}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              aria-label={rowLabel(row)}
              data-href={linkOf?.(row)}
              tabIndex={-1}
              onClick={() => {
                onOpen(row, { toSide: false })
              }}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key === "Enter") onOpen(row, { toSide: false })
                if ((event.ctrlKey || event.metaKey) && event.key === "c") {
                  asked.copied.push(copyOf(row))
                }
              }}
            >
              {columns.map((column) => (
                <td key={column.key} data-hide-below={column.hideBelow}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer !== undefined && (
          <tfoot>
            <tr>
              <td>{footer}</td>
            </tr>
          </tfoot>
        )}
      </table>
    )
  }
}

/** The slots of the editors' webview: its table, its named id, no addresses. */
export function editorSlots(): { readonly slots: ScreenSlots; readonly asked: ScreenAsked } {
  const asked: ScreenAsked = { opened: [], copied: [] }
  return {
    asked,
    slots: {
      Table: editorTable(asked),
      Id: ({ id, name }) => <NamedId name={name} id={id} layout="inline" />,
      onOpen: (target, how) => {
        asked.opened.push({ target, how })
      },
    },
  }
}

/** The slots of a page with addresses: its table, an id with its name, a link per target. */
export function pageSlots(): { readonly slots: ScreenSlots; readonly asked: ScreenAsked } {
  const asked: ScreenAsked = { opened: [], copied: [] }
  return {
    asked,
    slots: {
      Table: pageTable(asked),
      Id: ({ id, name, label }) => (
        <span title={label}>
          {name ?? ""}
          <code>{`id:${id}`}</code>
        </span>
      ),
      onOpen: (target, how) => {
        asked.opened.push({ target, how })
      },
      linkOf: (target) => {
        if (target.kind === "process") {
          return `/app/engines/${target.engine}/processes/${target.bpmnProcessId}`
        }
        return target.kind === "instance"
          ? `/app/engines/${target.engine}/instances/${target.instanceId}`
          : `/app/engines/${target.engine}`
      },
    },
  }
}
