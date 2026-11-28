# Claude artifacts

A Claude artifact is a live page in claude.ai. A page on Pulse reads your engine through the Pulse
MCP server, which the viewer has added in claude.ai as a connector: it calls the tools the chat
calls, signed in as the viewer, writes nothing, and shows the numbers in the Pulse look, light or
dark, English or German. Every page starts from the template `templates/claude-artifact`, which
gets a process dashboard running on recorded answers in minutes, and the Claude Code plugin
`pulse-artifact` starts Claude on a copy of it.

## Start from the template

[`templates/claude-artifact`](https://github.com/Miragon/pulse/tree/main/templates/claude-artifact)
holds one example page, a dashboard of the playground's `miraveloLeasing` process: its key
figures, the diagram with its badges, started and ended per day, the end events reached, open
incidents by activity and open tasks, the numbers of the cockpit's process detail in three calls.
Copy the folder out of a clone of the release its pins name on npm; you need Node.js 22.22.2 or
later and pnpm 10.32.1:

<!-- x-release-please-start-version -->

```sh
git clone --depth 1 --branch v0.34.0 https://github.com/Miragon/pulse
cp -r pulse/templates/claude-artifact my-dashboard
cd my-dashboard
pnpm install
pnpm dev
```

<!-- x-release-please-end -->

`pnpm dev` serves the page on the recorded answers in `fixtures/`, with no engine and no server.
The template's [README](https://github.com/Miragon/pulse/tree/main/templates/claude-artifact#readme)
takes it from there: your own process, recorded with `pnpm record` (only the fields the page
reads), the screenshots, the publish of the three files `pnpm build` writes and the `mcp`
capability the artifact then declares. The page renders in the system font; Geist from Google
Fonts is an opt-in there. The template's `CLAUDE.md` holds the rules an AI agent follows on a copy.

The page reads through widget-shell's page reads (`useSectionRead`, `PageGate`) and mounts with
its Claude artifact entry (`mountClaudeArtifact`), whose caller alone speaks to the artifact
runtime, so a copy keeps only its sections, its reads, its tests and its scripts. Its three tools
read the Camunda 7 REST API (CIB seven, Operaton, Camunda 7); of a Camunda 8 cluster a page reads
the JSON forms of the screens and boards, `engine_get_screen` and `engine_get_board`.

## The Claude Code plugin

The plugin `pulse-artifact` sits in the plugin marketplace `pulse` of this repository, next to
[the CLI's](../cli/agents.md#claude-code-plugin):

```text
/plugin marketplace add Miragon/pulse
/plugin install pulse-artifact@pulse
```

Its skill loads when you ask Claude for a dashboard, view or report on a process engine as a Claude
artifact. The marketplace installs it from the latest release's tag, so the skill names only what
that release's template holds: it clones the template from that tag and hands over to the copy's
`CLAUDE.md` and README. The plugin lives in
[`apps/mcp-server/skills/pulse-artifact`](https://github.com/Miragon/pulse/tree/main/apps/mcp-server/skills/pulse-artifact)
and carries the server's version. Claude Code does not update third-party plugins on its own: after
a release, run `claude plugin marketplace update pulse`, then
`claude plugin update pulse-artifact@pulse`.

## Without a build, an option

A page of a few panels can skip the template and ship no file once the artifact host accepts the
release's version: one module script loads pulse-ui's browser bundle, its stylesheet and
widget-shell's page reads from jsDelivr at that version, and Claude Code's artifact tool loads a
library only at a version published two weeks before or earlier. Until then, use the template.

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

<!-- x-release-please-end -->

`claude-artifact.js` takes React and the kit from that `pulse-ui.js`: load all three from one CDN
at one version. The widget-shell
[README](https://github.com/Miragon/pulse/tree/main/packages/core/widget-shell#use-in-a-page-without-a-build)
shows the whole page, the pulse-ui
[README](https://github.com/Miragon/pulse/tree/main/packages/core/ui#use-in-a-page-without-a-build)
what the bundle and the stylesheet hold. A page that reads a second connector declares it beside
the first and names it in its reads, `reader.call(tool, args, { connector })`.
