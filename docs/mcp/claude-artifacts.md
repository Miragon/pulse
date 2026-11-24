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
incidents by activity and open tasks. Copy the folder out of a clone; you need Node.js 22.22.2 or
later and pnpm 10.32.1:

```sh
git clone --depth 1 https://github.com/Miragon/pulse
cp -r pulse/templates/claude-artifact my-dashboard
cd my-dashboard
pnpm install
pnpm dev
```

`pnpm dev` serves the page on the recorded answers in `fixtures/`, through a stand-in for the
artifact's connector, so it needs no engine and no server. A dashboard of your own process changes
the one process key in `templates/claude-artifact/src/app.tsx`, records your engine's answers and
edits the sections, as the template's
[README](https://github.com/Miragon/pulse/tree/main/templates/claude-artifact#readme) shows.

| Command                          | What it does                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev`                       | The page on the fixtures, reloading on every change                              |
| `pnpm record -- --process <key>` | One load's calls against a Pulse MCP server (`MCP_URL`), written to `fixtures/`  |
| `pnpm shot`                      | Screenshots in light and dark, at 1240 and 390 px, into `shots/`                 |
| `pnpm build`                     | `dist/index.html`, `dist/app.js` and `dist/app.css`, the three files you publish |
| `pnpm typecheck`, `pnpm test`    | Types, the data rules, the page on the fixtures, the bundle and the brand gates  |

`pnpm record` reads `http://localhost:8400/mcp` unless `MCP_URL` names another server (with
`MCP_TOKEN` when it asks for a bearer token); in a clone of this repository, `pnpm play` serves the
Pulse MCP server there, against the playground's engine. Record in one run: ids change with every
start of an engine, so two recordings never join. A recording holds the engine's answers as they
came (user ids, business keys, incident messages, the cockpit URL), so record against a test
engine or leave the recording out of what you commit.

## The Claude Code plugin

The plugin `pulse-artifact` sits in the plugin marketplace `pulse` of this repository, next to
[the CLI's](../cli/agents.md#claude-code-plugin):

```text
/plugin marketplace add Miragon/pulse
/plugin install pulse-artifact@pulse
```

Its skill loads when you ask Claude for a dashboard, view or report on a process engine as a Claude
artifact. It starts from the template on GitHub and carries what a page needs: the artifact's
rules, the components with their props (a cheat sheet generated from pulse-ui's typings), the
design rules, which tool answers what, and a checklist from the recording to the publish. The
plugin lives in
[`apps/mcp-server/skills/pulse-artifact`](https://github.com/Miragon/pulse/tree/main/apps/mcp-server/skills/pulse-artifact)
and carries the server's version. Claude Code does not update third-party plugins on its own:
after a release, run `claude plugin marketplace update pulse`, then
`claude plugin update pulse-artifact@pulse`.

## Publish

1. Set `CONNECTOR_NAME` in `templates/claude-artifact/src/engine/claude-connector.ts` to the
   display name of the Pulse connector in claude.ai (Settings, Connectors).
2. `pnpm build`, then publish `dist/index.html` as the artifact, with `dist/app.js` and
   `dist/app.css` as its files.
3. After the first publish, declare the `mcp` capability: the same connector name, and exactly the
   tools of `PAGE_TOOLS` in `templates/claude-artifact/src/engine/tools.ts`. The runtime refuses
   a call to a tool it does not name.

An artifact loads scripts only from its own files and a few CDNs, stylesheets only from its own
files and Google Fonts, and fetches nothing else, so the build bundles everything the page runs.
`dist/app.js` is one classic script, never `type="module"`: the artifact's sandboxed frame has
the origin `null`, where a module script from its own files may fail on CORS. Check the
screenshots in light, dark and at 390 px before you publish.

## How a page calls the connector

The page calls `await window.claude.use("mcp")`, then
`callTool(CONNECTOR_NAME, tool, args, { cache })` with positional arguments, the connector's
display name first; the tool's JSON answer comes back in `payload`. The runtime keeps answers by
the cache options, `staleTime` the page's own 30 seconds, and Refresh, like Try again after a
failure, passes `refresh: true`, so the engine answers anew. A call the runtime refuses rejects
with a code the page words as what the viewer can do:

| Code                                         | What the viewer can do                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `needs_reauth`                               | Reconnect the connector in claude.ai under Settings, Connectors                           |
| `server_not_connected`, `selection_required` | Add the connector in claude.ai under Settings, Connectors, or pick it when claude.ai asks |
| `not_in_manifest`, `blocked_by_policy`       | Ask whoever published the page: it may not read the connector for them                    |
| `approval_required`                          | Allow the access when claude.ai asks, then try again                                      |
| `server_unavailable`                         | Try again: the Pulse MCP server does not answer                                           |

One thing is not known yet: whether a tool's own error answer resolves with `isError: true` or
rejects with another code. The template takes both as the server's error and words it as Pulse's
own views do, the engine's text under Details.

## What a load reads

Every read is a model tool of the read-only floor, so the page works on a server without OAuth and
on every toolset: `engine_list_engines` once for the engine, `engine_status` for running instances,
jobs without retries and open incidents, counts with `maxResults: 1`
(`engine_list_process_instances` with incident, `engine_list_tasks`,
`engine_query_historic_process_instances` for the last 24 hours), `engine_list_process_definitions`
and `engine_get_process_definition_xml` for the latest diagram, and pages of 100 of
`engine_list_incidents`, `engine_list_tasks`, `engine_query_historic_activity_instances` and
`engine_query_historic_process_instances`. On the playground, one load of the dashboard makes 24
calls, each kept 30 seconds; a busier process pages more. The numbers mean what the cockpit's
process detail shows: incidents are open root incidents, a call activity's copies count in the
called process, and "With incident" reads the runtime. Running badges miss the tokens that wait
before an asynchronous step. The reads are those of the Camunda 7 REST API, which CIB seven,
Operaton and Camunda 7 serve: a Camunda 8 engine refuses them.

## What comes next

The template carries a few parts that Pulse will provide instead, under the epic
[#668 Pulse for Claude artifacts](https://github.com/Miragon/pulse/issues/668). Each sits in
`templates/claude-artifact/src/temporary/`, headed by the issue that replaces it:

| Temporary part                            | Replaced by                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| The theme bridge and the build            | [#661](https://github.com/Miragon/pulse/issues/661), pulse-ui as a browser bundle    |
| The diagram with its badges               | [#662](https://github.com/Miragon/pulse/issues/662), the BPMN diagram as a component |
| The bar chart and the meter rows          | [#663](https://github.com/Miragon/pulse/issues/663), charts in the Pulse look        |
| The section states and the panels         | [#664](https://github.com/Miragon/pulse/issues/664), dashboard building blocks       |
| The count words, copied from the glossary | [#667](https://github.com/Miragon/pulse/issues/667), the glossary as browser data    |

The reads shrink too: [#665](https://github.com/Miragon/pulse/issues/665) brings a process's
numbers per day and per activity, and [#666](https://github.com/Miragon/pulse/issues/666) a
screen's JSON form, so a load will need a few calls and add up nothing in the page.
