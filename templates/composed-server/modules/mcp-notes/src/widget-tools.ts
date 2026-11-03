import { z } from "zod"
import type { MCPServer } from "mcp-use"
import {
  appOnly,
  buildDataFeedResult,
  buildViewResult,
  showToolBinding,
  strictToolInput,
  withToolErrors,
} from "@miragon/pulse-widget-shell/server"
import { NOTES_LIST_DATA, NOTES_SHOW_NOTES } from "./tool-names.js"
import type { NotesStore } from "./notes-store.js"

/**
 * Inputs shared by `notes_show_notes` and its `notes_list_data` feed,
 * declared through `strictToolInput`, the raw-path twin of the registrar's
 * strict input: an unknown key is refused, never stripped.
 */
const notesInputShape = {
  query: z
    .string()
    .optional()
    .describe("Case-insensitive filter matched against title, text, and tags."),
}

export function registerWidgetTools(server: MCPServer, store: NotesStore, title: string) {
  // Render path 2 of 3: renders the view for the user AND returns a short
  // summary for the model. Its structuredContent IS the view's data, and the
  // tool's name is the view's name (`notesViews` in `widgets/index.ts`). The
  // `_show_` naming is load-bearing: the server's widget-contract e2e test
  // asserts the view `_meta` on it by name.
  server.tool(
    {
      name: NOTES_SHOW_NOTES,
      title: "Team Notes",
      description: "Show the team's operations notes as an interactive list.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: strictToolInput(notesInputShape),
      ...showToolBinding(NOTES_SHOW_NOTES, "Team Notes"),
    },
    withToolErrors(async (args) => {
      const notes = store.list(args)
      return buildViewResult(
        { title, query: args.query ?? null, notes },
        `Showing ${notes.length} team note(s)` +
          `${args.query ? ` matching "${args.query}"` : ""}. ` +
          "Fetch the raw list with notes_list_notes.",
      )
    }),
  )

  // Render path 3 of 3: the app-only `*_data` feed the widget re-reads (a
  // retry, an invalidation after a write) and fetches when it is embedded
  // without data. Same builder, same arguments as the show tool. The `_data`
  // suffix is load-bearing: the e2e test asserts app-only visibility on it by name.
  server.tool(
    {
      name: NOTES_LIST_DATA,
      title: "Notes list data (internal)",
      description:
        "Internal JSON feed (no UI) for the notes widget's refresh. Prefer notes_show_notes.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: strictToolInput(notesInputShape),
      ...appOnly,
    },
    withToolErrors(async (args) =>
      buildDataFeedResult({ title, query: args.query ?? null, notes: store.list(args) }),
    ),
  )
}
