import type { ReactNode } from "react"
import { DataTableRow, useLocale } from "@miragon/pulse-ui"
import { useCopyId } from "./id-text.js"
import { kitLabels } from "./kit-labels.js"

/**
 * A row of a `ListTable` that opens what it names, one row convention with the webview's tables:
 * a click on the row (not on a control in it) or Enter opens it, Ctrl or Cmd with C copies its id
 * (`copy`, or what `copyLabel` names) and says so in a toast, unless the reader selected text in
 * the row, which the browser copies. A screen reader hears its `label` and that Enter opens it; the
 * table keeps one tab stop for its rows, the arrows move between them. Its further actions (a
 * write, a hand-off, `MoreActions`) stay controls at the row's end and open nothing; the row needs
 * no drill. Without `onOpen` (a row whose view this surface cannot show) it is a plain row. On a
 * page with addresses the row links to what it opens (`href`): a new tab where the click asks.
 */
export function ListRow({
  label,
  onOpen,
  href,
  copy,
  copyLabel,
  className,
  children,
}: {
  /** The row's accessible name: what it opens ("Instance ORD-1001"). */
  label: string
  onOpen?: () => void
  /**
   * The address of what the row opens, on a page with addresses: the row is a link to it, so Ctrl
   * or Cmd with a click or Enter and a middle click open it in a new tab (pulse-ui's
   * `DataTableRow`); a plain click or Enter open it in place (`onOpen`). A chat has no address.
   */
  href?: string
  /** What Ctrl or Cmd with C copies: its id. */
  copy?: string
  /**
   * The name of what `copy` holds where it is no id ("Incident message"), for its toast; the
   * table's `copyHint` says it to a screen reader.
   */
  copyLabel?: string
  className?: string
  /** The row's cells, one per column. */
  children: ReactNode
}) {
  const labels = kitLabels(useLocale())
  const copyId = useCopyId({
    copied: copyLabel === undefined ? undefined : labels.copiedOf(copyLabel),
    failed: copyLabel === undefined ? undefined : labels.copyFailedOf(copyLabel),
    failedHint: labels.rowCopyFailedHint,
  })
  return (
    <DataTableRow
      label={label}
      onActivate={onOpen && (() => onOpen())}
      href={href}
      onCopy={copy === undefined ? undefined : () => void copyId(copy)}
      className={className}
    >
      {children}
    </DataTableRow>
  )
}
