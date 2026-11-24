# Claude artifacts

A Claude artifact is a live page in claude.ai. A page on Pulse reads your engine through the Pulse
MCP server, which the viewer has added in claude.ai as a connector: it calls the tools the chat
calls, signed in as the viewer, and shows the numbers in the Pulse look, light or dark. The
template `templates/claude-artifact` gets a new process dashboard running on recorded answers in
minutes, and the Claude Code plugin `pulse-artifact` teaches Claude to build one from it.

## Start from the template

[`templates/claude-artifact`](https://github.com/Miragon/pulse/tree/main/templates/claude-artifact)
holds one example page, a dashboard of the playground's `miraveloLeasing` process: its key
figures, the diagram with its badges, started and ended per day, the end events reached, open
incidents by activity and open tasks. Copy the folder out of a clone of the release its pins name
on npm; you need Node.js 22.22.2 or later and pnpm 10.32.1:

<!-- x-release-please-start-version -->

```sh
git clone --depth 1 --branch v0.32.0 https://github.com/Miragon/pulse
cp -r pulse/templates/claude-artifact my-dashboard
cd my-dashboard
pnpm install
pnpm dev
```

<!-- x-release-please-end -->

`pnpm dev` serves the page on the recorded answers in `fixtures/`, through a stand-in for the
artifact's connector, with no engine and no server. A dashboard of your own process changes
`PROCESS_KEY` in `templates/claude-artifact/src/app.tsx`, records your engine's answers and edits
the sections, as the
[README](https://github.com/Miragon/pulse/tree/main/templates/claude-artifact#readme) shows.

| Command                          | What it does                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm dev`                       | The page on the fixtures, reloading on every change                                   |
| `pnpm record -- --process <key>` | One load's three calls against a Pulse MCP server (`MCP_URL`), written to `fixtures/` |
| `pnpm shot`                      | Screenshots in light and dark, at 1240 and 390 px, into `shots/`                      |
| `pnpm build`                     | `dist/index.html`, `dist/app.js` and `dist/pulse-ui.css`, the three files you publish |
| `pnpm typecheck`, `pnpm test`    | Types, the data rules, the page on the fixtures, the bundle and the brand gates       |

`pnpm record` reads `http://localhost:8400/mcp`, which `pnpm play` serves in a clone of this
repository against the playground's engine, unless `MCP_URL` names another server (`MCP_TOKEN` for a
bearer token). Record in one run, since ids change with every start of an engine, and against a test
engine: a recording holds the engine's answers as they came (incident messages, the process model).

The page is built from pulse-ui alone: `BpmnDiagram` and `DiagramLegend` of
`@miragon/pulse-ui/bpmn`, `BarChart` and `MeterRows`, `SectionState` in `Panel`s on a `PanelGrid`,
the count words of `@miragon/pulse-ui/glossary` and pulse-ui's browser stylesheet as its one
stylesheet, which follows the viewer's theme, else the OS.

## The Claude Code plugin

The plugin `pulse-artifact` sits in the plugin marketplace `pulse` of this repository, next to
[the CLI's](../cli/agents.md#claude-code-plugin):

```text
/plugin marketplace add Miragon/pulse
/plugin install pulse-artifact@pulse
```

Its skill loads when you ask Claude for a dashboard, view or report on a process engine as a Claude
artifact. It starts from the template and carries what a page needs: the artifact's rules, the
components with their props (a sheet generated from pulse-ui's typings), the design rules, which
tool answers what, and a checklist from the recording to the publish. The plugin lives in
[`apps/mcp-server/skills/pulse-artifact`](https://github.com/Miragon/pulse/tree/main/apps/mcp-server/skills/pulse-artifact)
and carries the server's version. Claude Code does not update third-party plugins on its own: after
a release, run `claude plugin marketplace update pulse`, then
`claude plugin update pulse-artifact@pulse`.

## Publish

1. Set `CONNECTOR_NAME` in `templates/claude-artifact/src/engine/claude-connector.ts` to the
   display name of the Pulse connector in claude.ai (Settings, Connectors).
2. `pnpm build`, then publish `dist/index.html` as the artifact, with `dist/app.js` and
   `dist/pulse-ui.css` as its files.
3. After the first publish, declare the `mcp` capability: the same connector name, and exactly the
   tools of `PAGE_TOOLS` in `templates/claude-artifact/src/engine/tools.ts`. The runtime refuses
   a call to a tool it does not name.

An artifact loads scripts only from its own files and a few CDNs, stylesheets only from its own
files and Google Fonts, and fetches nothing else, so the build bundles everything the page runs.
`dist/app.js` is one classic script, never `type="module"`: the artifact's sandboxed frame has
the origin `null`, where a module script from its own files may fail on CORS. Check the
screenshots in light, dark and at 390 px before you publish.

## Without a build

A small page needs no template: a module script loads pulse-ui's browser bundle from jsDelivr,
and the artifact's one file is `pulse-ui.css` of the same version, copied from the package's
`dist/browser/`. Pin the release's version:

<!-- x-release-please-start-version -->

```html
<link rel="stylesheet" href="pulse-ui.css" />
<div id="root"></div>
<script type="module">
  import * as ui from "https://cdn.jsdelivr.net/npm/@miragon/pulse-ui@0.32.0/dist/browser/pulse-ui.js"
  const mcp = await window.claude.use("mcp")
  const args = { processDefinitionKey: "miraveloLeasing", bucket: "day" }
  const cache = { staleTime: 30000, gcTime: 600000 }
  const { payload } = await mcp.callTool("Pulse", "engine_process_stats", args, { cache })
  const title = payload.processDefinitionName ?? payload.processDefinitionKey
  ui.createRoot(document.getElementById("root")).render(
    ui.createElement(ui.WidgetHeader, { title }),
  )
</script>
```

<!-- x-release-please-end -->

`pulse-ui-bpmn.js` beside the bundle draws the diagram on the same React. The pulse-ui
[README](https://github.com/Miragon/pulse/tree/main/packages/core/ui#use-in-a-page-without-a-build)
lists what the bundle and the stylesheet hold.

## How a page calls the connector

The page calls `await window.claude.use("mcp")`, then
`callTool(CONNECTOR_NAME, tool, args, { cache })`, the connector's display name first; the JSON
answer comes back in `payload`. The runtime keeps answers for the page's 30 seconds (`staleTime`);
Refresh and Try again pass `refresh: true` past that cache, but the server answers from its own
30-second floor, so the bar dates the numbers by each answer's `asOf`. A refused call rejects with a
code the page words through pulse-ui's `describePageError`:

| Code                                         | What the viewer can do                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `needs_reauth`                               | Reconnect the connector in claude.ai under Settings, Connectors                           |
| `server_not_connected`, `selection_required` | Add the connector in claude.ai under Settings, Connectors, or pick it when claude.ai asks |
| `not_in_manifest`, `blocked_by_policy`       | Ask whoever published the page: it may not read the connector for them                    |
| `approval_required`                          | Allow the access when claude.ai asks, then try again                                      |
| `server_unavailable`                         | Try again: the Pulse MCP server does not answer                                           |

Not known yet: whether a tool's own error answer resolves with `isError: true` or rejects with
another code; the template takes both as the server's error, its text under Details.

## What a load reads

Three calls, each a model tool of the read-only floor, so the page works on a server without OAuth
and on every toolset: `engine_process_stats` (bucket `day`, the viewer's time zone) for the key
figures, started and ended per day, the durations and the end events reached;
`engine_activity_counts` for the badges, the open incidents by activity and the open tasks; and
`engine_get_process_definition_xml` of the version those counts are drawn on. The server reads with
the cockpit's builders and keeps each answer 30 seconds per caller; the page adds nothing up. The
numbers are the process detail's: incidents are open root incidents, a call activity's copies count
in the called process, "With incident" reads the runtime, and the running badges count the tokens as
the cockpit does. A page of the shared blocks reads a screen or a board in one call
(`engine_get_screen`, `engine_get_board`). The process numbers are those of the Camunda 7 REST API
(CIB seven, Operaton, Camunda 7): a Camunda 8 engine refuses them.
