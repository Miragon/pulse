import { WidgetHeader, TableEmptyState, Td, formatTimestamp } from "@miragon/pulse-ui"
import {
  ListTable,
  QueryFallback,
  TableSkeleton,
  WidgetShell,
  useViewData,
} from "@miragon/pulse-widget-shell/widgets"
import { NOTES_LIST_DATA } from "../tool-names.js"
import type { NotesListData } from "../notes-store.js"

/**
 * The notes list widget. A `notes_show_notes` render hands in `data` (via `NotesListView` in
 * `widgets/views.tsx`), which SEEDS the `notes_list_data` feed's cache entry: a retry or an
 * invalidation after a write re-reads the feed with the same filter. Mounted without data (on
 * another view), it fetches the feed itself. Never the show tool, whose result the host would
 * render as a second view.
 */
export function NotesListWidget({ data: initialData }: { data: NotesListData | null }) {
  const args = initialData?.query ? { query: initialData.query } : {}
  const { data, error, refetch } = useViewData<NotesListData>(
    initialData,
    ["notes:list"],
    NOTES_LIST_DATA,
    args,
    true,
  )

  if (!data) {
    return (
      <WidgetShell>
        <WidgetHeader title="Team Notes" />
        <QueryFallback
          isError={error !== null}
          error={error}
          errorTitle="Failed to load notes"
          onRetry={refetch}
          skeleton={<TableSkeleton />}
        />
      </WidgetShell>
    )
  }

  return (
    <WidgetShell>
      <WidgetHeader title={data.title} sub={`${data.notes.length} note(s)`} />
      {data.notes.length === 0 ? (
        <TableEmptyState>No notes match the current filter.</TableEmptyState>
      ) : (
        <ListTable
          ariaLabel="Notes"
          columns={[
            { label: "Note" },
            // Column priority: the tags hide while the table is narrow.
            { label: "Tags", hideBelow: "sm" },
            { label: "Updated", align: "right" },
          ]}
        >
          {data.notes.map((note) => (
            <tr key={note.id}>
              <Td>
                <div className="font-medium">{note.title}</div>
                <div className="text-muted-foreground mt-0.5">{note.text}</div>
              </Td>
              <Td>{note.tags.join(", ")}</Td>
              <Td align="right">{formatTimestamp(note.updatedAt)}</Td>
            </tr>
          ))}
        </ListTable>
      )}
    </WidgetShell>
  )
}
