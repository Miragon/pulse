---
name: pulse-artifact
description: Build a Claude artifact on Pulse, a live page in claude.ai (a dashboard, view or report on a Camunda 7, Operaton or CIB seven process engine) that reads the engine through the Pulse MCP server as the viewer's connector, starting from a copy of the Pulse template on the pulse-ui components, whose agent file carries the rules and the publish checklist. Use it whenever such a page over an engine, its processes, incidents, instances or tasks is asked for.
---

# Claude artifacts on Pulse

A Claude artifact on Pulse is a page in claude.ai that reads a process engine through the
viewer's own connector to the Pulse MCP server and shows it in the Pulse look: a process
dashboard, a view, a report. It reads with the viewer's sign-in and toolset and writes nothing.

**Use this skill** for such a page, built from the template and published as an artifact.
**Not for:** an answer in the chat (call the engine tools, or open the cockpit with
`engine_open_cockpit`), changing an engine (the chat or the Pulse CLI), a page unrelated to a
process engine, BPMN modelling, or a Camunda 8 cluster: the template reads Camunda 7 REST engines
(Operaton, CIB seven, Camunda 7), and a Camunda 8 engine refuses its calls.

## Get the template

The template is `templates/claude-artifact` in the Pulse repository
(https://github.com/Miragon/pulse/tree/main/templates/claude-artifact). This plugin holds no copy
of it and installs from `main`, while the template builds on the libraries of the release its pins
name on npm: clone that release, never `main`.

<!-- x-release-please-start-version -->

```sh
git clone --depth 1 --branch v0.33.0 https://github.com/Miragon/pulse
cp -r pulse/templates/claude-artifact my-dashboard && cd my-dashboard
pnpm install
pnpm dev        # the example dashboard on the recorded fixtures, no server needed
```

<!-- x-release-please-end -->

The example is a dashboard of the playground's `miraveloLeasing` process, read in three calls:
`engine_process_stats`, `engine_activity_counts` and `engine_get_process_definition_xml`. A page
of another process, or of another kind, starts from it too and keeps its engine layer, its tests
and its scripts; a tool it calls beyond these joins `PAGE_TOOLS` first.

## Then read the copy

Read the copy's `CLAUDE.md`, then its `README.md`, before you change anything. They are written
for the release the copy pins: where they differ from this skill or from what you remember of
another version, they win.

- `CLAUDE.md`: the artifact runtime's rules, the two values a copy sets, the data rules, which
  tool feeds which section, the look, where the components are documented, and the checklist
  from the recording to the publish.
- `README.md`: the commands, recording your own process, how the page reads and what the tests
  hold.

Follow the checklist to its end: the page reads nothing until its `mcp` capability is declared
after the first publish.

## Without a build

A page of a few panels can skip the template: one module script imports pulse-ui's browser bundle
(`dist/browser/pulse-ui.js`) from jsDelivr at the version of the release above, never `latest`, and
the page ships the package's `pulse-ui.css` as its one file. The pulse-ui README shows how
(https://github.com/Miragon/pulse/tree/main/packages/core/ui#use-in-a-page-without-a-build). The
page reads the engine with the template's one call:

```js
const mcp = await window.claude.use("mcp")
const cache = { staleTime: 30000, gcTime: 600000 }
const { payload } = await mcp.callTool("<the connector's display name>", tool, args, { cache })
```

The answer is the tool's JSON in `payload`. A refusal rejects with the runtime's `code`:
`RUNTIME_CODES` in `templates/claude-artifact/src/engine/claude-connector.ts` maps it onto
pulse-ui's page errors, which `describePageError` words, and any other code is the server's error.
After the first publish, declare `mcp` for that connector with exactly the tools the page calls,
and load the `artifact-capabilities` skill before you declare. The template's data rules and its
look hold here too; its three files and its classic script do not.
