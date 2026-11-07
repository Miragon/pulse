import { readFileSync } from "node:fs"
import path from "node:path"
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
import { OWN_VIEW_FEED, OWN_VIEW_TOOL } from "./engines.js"

/**
 * A module with a finished HTML view of its own (own-view.spec.ts): the fixture module
 * scripts/test-template.sh installs into a starter, its document and its data alike. Its source
 * resolves no package from this app, so this registers the document through the SDK's own API,
 * which the add-widget skill says works just the same as ext-apps' helpers the fixture uses.
 */

const BOARD_URI = "ui://board/board.html"
const CSP: AppResourceCsp = { connectDomains: ["https://api.example.com"] }
const BOARD_HTML = readFileSync(
  path.join(import.meta.dirname, "../../../templates/fixtures/prebuilt-module/src/board.html"),
  "utf8",
)
const CARDS = [
  { id: "A-1", title: "Invoice import stuck", lane: "Doing" },
  { id: "A-2", title: "Renew the signing key", lane: "To do" },
  { id: "A-3", title: "Archive last quarter", lane: "Done" },
]

function register(server: ModuleServer): void {
  server.registerTool(
    OWN_VIEW_TOOL,
    {
      title: "Team board",
      description: "Shows the team's board.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: strictToolInput({ team: z.string().optional() }),
      ...showToolBinding(OWN_VIEW_TOOL, "Team board", { resourceUri: BOARD_URI, csp: CSP }),
    },
    ({ team }) =>
      buildViewResult({ team: team ?? "all teams", cards: CARDS }, `${CARDS.length} cards.`),
  )
  server.registerTool(OWN_VIEW_FEED, { annotations: { readOnlyHint: true }, ...appOnly }, () =>
    buildDataFeedResult({ cards: CARDS.length }),
  )
  server.registerResource(
    "Team board",
    BOARD_URI,
    { description: "The team's board.", mimeType: "text/html;profile=mcp-app" },
    () => ({
      contents: [
        {
          uri: BOARD_URI,
          mimeType: "text/html;profile=mcp-app",
          text: BOARD_HTML,
          _meta: { ui: { csp: CSP } },
        },
      ],
    }),
  )
}

export const ownViewModule = {
  name: "board",
  configFromEnv: () => ({}),
  knownEnvVars: [],
  createPlugin: () => ({ name: "board", register }),
} satisfies ComposableModule<object>
