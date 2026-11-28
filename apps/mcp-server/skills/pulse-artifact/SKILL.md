---
name: pulse-artifact
description: Build a Claude artifact on Pulse, a live page in claude.ai (a dashboard, view or report on a Camunda 7, Operaton or CIB seven process engine, or on the screens and boards of a Camunda 8 cluster) that reads the engine through the Pulse MCP server as the viewer's connector, starting from a copy of the Pulse template on the pulse-ui components, whose agent file carries the rules and the publish checklist. Use it whenever such a page over an engine, its processes, incidents, instances or tasks is asked for.
---

# Claude artifacts on Pulse

A Claude artifact on Pulse is a page in claude.ai that reads a process engine through the
viewer's own connector to the Pulse MCP server and shows it in the Pulse look: a process
dashboard, a view, a report. It reads with the viewer's sign-in and toolset and writes nothing.

**Use this skill** for such a page, built from the template and published as an artifact.
**Not for:** an answer in the chat (call the engine tools, or open the cockpit with
`engine_open_cockpit`), changing an engine (the chat or the Pulse CLI), a page unrelated to a
process engine, or BPMN modelling.

## Get the template

Every page starts from the template, `templates/claude-artifact` in the Pulse repository. This
plugin holds no copy of it: the plugin is the one of a release, which the marketplace installs
from the release's tag, and the template builds on that release's libraries on npm. Clone the
same release, never `main`:

<!-- x-release-please-start-version -->

The template of this release: https://github.com/Miragon/pulse/tree/v0.34.0/templates/claude-artifact

```sh
git clone --depth 1 --branch v0.34.0 https://github.com/Miragon/pulse
cp -r pulse/templates/claude-artifact my-dashboard && cd my-dashboard
pnpm install
pnpm dev        # the example dashboard on the recorded fixtures, no server needed
```

<!-- x-release-please-end -->

The example is a dashboard of the playground's `miraveloLeasing` process, read in three calls:
`engine_process_stats`, `engine_activity_counts` and `engine_get_process_definition_xml`. A page
of another process, or of another kind, starts from it too and keeps its sections, reads, tests
and scripts, on widget-shell's page reads; a tool it calls beyond these joins `PAGE_TOOLS` first.

## On a Camunda 8 cluster

The template's three tools read the Camunda 7 REST API (Operaton, CIB seven, Camunda 7), and the
server serves them for such engines alone, so on a Camunda 8 cluster their calls fail. What a page
reads of a cluster are the JSON forms of the web app's screens and of the boards, which the server
serves for every engine: `engine_get_screen` (`screen` `engine`, `process` or `instance`) and
`engine_get_board`, each answer with its `formatVersion`. Such a page starts from the template
too: these tools take the place of the three in `PAGE_TOOLS` and `src/data/recorded-reads.ts`,
and its sections read them.

## Then read the copy

Read the copy's `CLAUDE.md`, then its `README.md`, before you change anything. They are written
for the release the copy pins: where they differ from this skill or from what you remember of
another version, they win.

- `CLAUDE.md`: the artifact runtime's rules, the values a copy sets (the process, the connector
  and the tools the page calls), the data rules, which tool feeds which section, the look, where
  the components are documented, and the checklist from the recording to the publish.
- `README.md`: the commands, recording your own process, how the page reads, the font and what
  the tests hold.

Follow the checklist to its end: the page reads nothing until its `mcp` capability is declared
after the first publish.

## Without a build, an option

Offer a page without a build only when one is asked for and its version is one the host accepts.
Such a page loads pulse-ui's browser bundle, its stylesheet and widget-shell's page reads for a
Claude artifact from jsDelivr at this release's version, never `latest`. Claude Code's artifact
tool loads a library only at a version published at least two weeks before, so look up when this
one was (`npm view @miragon/pulse-widget-shell time --json`), and build from the template while
it is younger:

<!-- x-release-please-start-version -->

```js
import * as ui from "https://cdn.jsdelivr.net/npm/@miragon/pulse-ui@0.34.0/dist/browser/pulse-ui.js"
import "https://cdn.jsdelivr.net/npm/@miragon/pulse-ui@0.34.0/dist/browser/pulse-ui-css.js"
import {
  mountClaudeArtifact,
  PageGate,
  usePageReads,
  useSectionRead,
} from "https://cdn.jsdelivr.net/npm/@miragon/pulse-widget-shell@0.34.0/dist/browser/claude-artifact.js"
```

The whole page and its rules: widget-shell's README of this release,
https://github.com/Miragon/pulse/tree/v0.34.0/packages/core/widget-shell#use-in-a-page-without-a-build

<!-- x-release-please-end -->

Each section reads with `useSectionRead(key, (reader) => reader.call(tool, args))` and renders
through pulse-ui's `SectionState`, `PageGate` around the sections says a refused connector once,
and `mountClaudeArtifact(App, { connector: "<the connector's display name>" })` mounts the page.
`pulse-ui-css.js` puts the kit's stylesheet into the page, so the page links none and renders in
the viewer's system font. Take React and the kit from that `pulse-ui.js` only, and load all three
from one CDN at one version. After the first publish, declare `mcp` for that connector with
exactly the tools the page calls, and load the `artifact-capabilities` skill before you declare.
The template's data rules and its look hold here too; its three files and its classic script do
not.
