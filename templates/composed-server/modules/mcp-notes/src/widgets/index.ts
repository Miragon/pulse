import { adaptDataWidget, type DescribeForModel } from "@miragon/pulse-widget-shell/ui"
import type { WidgetComponent } from "@miragon/mcp-toolkit-ui/app"
import { NotesListWidget } from "./notes-list.js"
import type { NotesListData } from "../notes-store.js"

/**
 * Component map for the host bundle, keyed by the ids the show tools name
 * (`widget: "notes:list"` in `widget-tools.ts`). The server spreads it into its
 * `widget-registry.ts`; its `widget-registry.test.ts` reads those ids from this
 * module's sources and fails on one the registry cannot render.
 */

// Model-context description so the model always knows what the user is
// looking at — the house pattern from the camunda7/analytics modules.
const describeNotes: DescribeForModel<NotesListData> = (data) =>
  `Viewing the "${data.title}" notes list: ${data.notes.length} note(s). ` +
  "Fetch the raw list with notes_list_notes."

export const notesWidgets: Record<string, WidgetComponent> = {
  "notes:list": adaptDataWidget(NotesListWidget, "notes:list", describeNotes),
}
