import { HostModelContext, type ViewMap, type ViewProps } from "@miragon/pulse-widget-shell/widgets"
import { NOTES_SHOW_NOTES } from "../tool-names.js"
import type { NotesListData } from "../notes-store.js"
import { NotesListWidget } from "./notes-list.js"

/**
 * Model-context description, so the model always knows what the user is
 * looking at: the house pattern from the engine/analytics modules.
 */
function describeNotes(data: NotesListData): string {
  return (
    `Viewing the "${data.title}" notes list: ${data.notes.length} note(s). ` +
    "Fetch the raw list with notes_list_notes."
  )
}

/** `notes_show_notes`: the list on the show tool's data, described for the model. */
function NotesListView({ data }: ViewProps<NotesListData>) {
  return (
    <HostModelContext content={describeNotes(data)}>
      <NotesListWidget data={data} />
    </HostModelContext>
  )
}

/**
 * The module's views by view name (= show tool name). The server spreads them
 * into its `src/ui/view-registry.ts`; its `view-registry.test.ts` fails on a
 * view-bound tool without a view.
 */
export const notesViews: ViewMap = {
  [NOTES_SHOW_NOTES]: NotesListView,
}
