import { DataTable, TableEmptyState } from "@miragon/pulse-ui"
import type { ScreenTarget } from "@miragon/pulse-screens"
import type { InstanceSlots, ScreenCopy, ScreenLinkProps, ScreenPlainTableProps } from "../slots.js"

/** What an instance's blocks asked of a surface: the targets its links opened and its copies. */
export interface InstanceAsked {
  readonly opened: { readonly target: ScreenTarget; readonly toSide: boolean }[]
  readonly copied: ScreenCopy[]
}

/**
 * The editors' plain table, as the webview's slot builds it: pulse-ui's `DataTable` with plain
 * rows (no target, no copy), every column kept, since the user sizes them.
 */
function EditorTable<Row>({
  name,
  label,
  columns,
  rows,
  rowKey,
  empty,
}: ScreenPlainTableProps<Row>) {
  return (
    <div data-testid="editor-table" data-name={name}>
      <DataTable<Row>
        label={label}
        columns={columns.map((column) => ({
          key: column.key,
          name: column.label,
          label: column.label,
          cell: column.cell,
        }))}
        rows={rows}
        rowKey={rowKey}
        empty={<p data-part="table-empty">{empty}</p>}
      />
    </div>
  )
}

/** A page's plain table, as the web app's slot over widget-shell's `ListTable` builds one. */
function PageTable<Row>({ name, label, columns, rows, rowKey, empty }: ScreenPlainTableProps<Row>) {
  if (rows.length === 0) return <TableEmptyState>{empty}</TableEmptyState>
  return (
    <table aria-label={label} data-testid="page-table" data-name={name}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((column) => (
              <td key={column.key}>{column.cell(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The address a page gives a target. */
function pageAddressOf(target: ScreenTarget): string {
  switch (target.kind) {
    case "engine":
      return `/app/engines/${target.engine}`
    case "process":
      return `/app/engines/${target.engine}/processes/${target.bpmnProcessId}`
    case "version":
      return `/app/engines/${target.engine}/processes/${target.bpmnProcessId}?version=${String(target.version)}`
    case "instance":
      return `/app/engines/${target.engine}/instances/${target.instanceId}`
  }
}

/** The slots of the editors' webview: its plain table, a link that is a button, its copy intent. */
export function editorInstanceSlots(): {
  readonly slots: InstanceSlots
  readonly asked: InstanceAsked
} {
  const asked: InstanceAsked = { opened: [], copied: [] }
  function EditorLink({ rel, target, title, children }: ScreenLinkProps) {
    return (
      <button
        type="button"
        data-rel={rel}
        title={title}
        onClick={(event) => {
          asked.opened.push({ target, toSide: event.ctrlKey || event.metaKey })
        }}
      >
        {children}
      </button>
    )
  }
  return {
    asked,
    slots: {
      PlainTable: EditorTable,
      Link: EditorLink,
      onCopy: (copy) => {
        asked.copied.push(copy)
      },
    },
  }
}

/** The slots of a page with addresses: its plain table, a link with its address, its copy. */
export function pageInstanceSlots(): {
  readonly slots: InstanceSlots
  readonly asked: InstanceAsked
} {
  const asked: InstanceAsked = { opened: [], copied: [] }
  function PageLink({ rel, target, title, children }: ScreenLinkProps) {
    return (
      <a
        href={pageAddressOf(target)}
        data-rel={rel}
        title={title}
        onClick={(event) => {
          event.preventDefault()
          asked.opened.push({ target, toSide: false })
        }}
      >
        {children}
      </a>
    )
  }
  return {
    asked,
    slots: {
      PlainTable: PageTable,
      Link: PageLink,
      onCopy: (copy) => {
        asked.copied.push(copy)
      },
    },
  }
}

/** Both surfaces' slots, for a block's tests that render it on each. */
export const SURFACES = [
  ["the editors' slots", editorInstanceSlots],
  ["a page's slots", pageInstanceSlots],
] as const
