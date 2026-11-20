import { useCallback, useMemo } from "react"
import type {
  InstanceSlots,
  ScreenCopy,
  ScreenLinkProps,
  ScreenPlainTableProps,
} from "@miragon/pulse-blocks"
import { cn, FOCUS_RING, TableEmptyState, Td, useToast } from "@miragon/pulse-ui"
import { ListTable } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../../messages/index.js"
import { PageLink, type Navigate } from "../../router/page-link.js"
import { targetUrl } from "../slots.js"

/**
 * The page's table whose rows open nothing (an instance's history, its waits, its variables):
 * widget-shell's `ListTable` (its named scroll region, the sticky head, a column a narrow region
 * drops) at the height its tab leaves it, its rows scrolling in that region; an empty table is the
 * kit's empty state. The block owns the columns, the cells and the words.
 */
function PagePlainTable<Row>({ label, columns, rows, rowKey, empty }: ScreenPlainTableProps<Row>) {
  if (rows.length === 0) return <TableEmptyState>{empty}</TableEmptyState>
  return (
    <ListTable
      ariaLabel={label}
      fill
      columns={columns.map((column) => ({
        label: column.label,
        ...(column.hideBelow === undefined ? {} : { hideBelow: "sm" as const }),
      }))}
    >
      {rows.map((row) => (
        <tr key={rowKey(row)}>
          {columns.map((column) => (
            <Td key={column.key}>{column.cell(row)}</Td>
          ))}
        </tr>
      ))}
    </ListTable>
  )
}

/** A link of a block, in the page's quiet look: underlined text in the link's colour. */
const LINK = cn(
  "text-link rounded-xs underline decoration-1 underline-offset-3 hover:decoration-2",
  FOCUS_RING,
)

/**
 * The page's copy of a block's text: on the clipboard, and a toast that names what it copied, or
 * that it could not (the browser refused the clipboard).
 */
function useCopy(): (copy: ScreenCopy) => void {
  const t = useT()
  const toast = useToast()
  return useCallback(
    (copy: ScreenCopy) => {
      const done = () =>
        toast.show({ tone: "success", title: t("copy.done", { label: copy.label }) })
      const failed = () =>
        toast.show({
          tone: "danger",
          title: t("copy.failed", { label: copy.label }),
          description: t("copy.failedHint"),
        })
      // A page served without a secure context (plain http beyond loopback) has no clipboard.
      const clipboard = navigator.clipboard as Clipboard | undefined
      if (clipboard === undefined) {
        failed()
        return
      }
      clipboard.writeText(copy.text).then(done, failed)
    },
    [t, toast],
  )
}

/**
 * The slots the page brings to an instance's blocks: its plain table at the height its tab leaves
 * it, its link to a target (a real `<a href>` of the page's router, so Ctrl or Cmd with a click and
 * a middle click open a new tab) and its copy. The page writes nothing, so it fills no write slot.
 */
export function useInstanceSlots(navigate: Navigate): InstanceSlots {
  const onCopy = useCopy()
  const Link = useMemo(
    () =>
      function PageTargetLink({ rel, target, title, children }: ScreenLinkProps) {
        return (
          <PageLink
            href={targetUrl(target)}
            navigate={navigate}
            title={title}
            data-rel={rel}
            className={LINK}
          >
            {children}
          </PageLink>
        )
      },
    [navigate],
  )
  return useMemo(() => ({ PlainTable: PagePlainTable, Link, onCopy }), [Link, onCopy])
}
