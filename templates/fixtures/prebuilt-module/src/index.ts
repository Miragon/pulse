/**
 * A prebuilt module, as the add-widget skill's "A finished HTML view" has it: its view is one
 * finished HTML document it brings itself, outside the server's Vite bundle. No cast and no
 * hand-written tool `_meta`: `registerAppTool` and `registerAppResource` take the `ModuleServer`
 * as it is. scripts/test-template.sh builds, packs and installs it into a starter copy.
 */
import { readFileSync } from "node:fs"
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server"
import {
  appOnly,
  buildDataFeedResult,
  buildViewResult,
  showToolBinding,
  strictToolInput,
  type AppResourceCsp,
  type ComposableModule,
  type ModuleServer,
} from "@miragon/pulse-widget-shell/server"
import { z } from "zod"

const BOARD_URI = "ui://board/board.html"
const SHOW_BOARD = "board_show_board"
/** The one origin this document calls; the server's font origin is none of its business. */
const CSP: AppResourceCsp = { connectDomains: ["https://api.example.com"] }
const BOARD_HTML = readFileSync(new URL("./board.html", import.meta.url), "utf8")

const CARDS = [
  { id: "A-1", title: "Invoice import stuck", lane: "Doing" },
  { id: "A-2", title: "Renew the signing key", lane: "To do" },
  { id: "A-3", title: "Archive last quarter", lane: "Done" },
]

function register(server: ModuleServer): void {
  // As ext-apps' docs have it: the tool first, the resource it binds after it.
  registerAppTool(
    server,
    SHOW_BOARD,
    {
      title: "Team board",
      description: "Shows the team's board.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: strictToolInput({ team: z.string().optional() }),
      ...showToolBinding(SHOW_BOARD, "Team board", { resourceUri: BOARD_URI, csp: CSP }),
    },
    ({ team }) =>
      buildViewResult({ team: team ?? "all teams", cards: CARDS }, `${CARDS.length} cards.`),
  )
  server.registerTool("board_cards_data", { annotations: { readOnlyHint: true }, ...appOnly }, () =>
    buildDataFeedResult({ cards: CARDS.length }),
  )
  registerAppResource(
    server,
    "Team board",
    BOARD_URI,
    { description: "The team's board." },
    () => ({
      contents: [
        {
          uri: BOARD_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: BOARD_HTML,
          _meta: { ui: { csp: CSP } },
        },
      ],
    }),
  )
}

export const boardModule = {
  name: "board",
  configFromEnv: () => ({}),
  knownEnvVars: [],
  createPlugin: () => ({ name: "board", register }),
} satisfies ComposableModule<object>
