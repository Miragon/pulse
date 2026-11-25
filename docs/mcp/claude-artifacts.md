# Claude artifacts

A Claude artifact is a live page in claude.ai. A page on Pulse reads your engine through the Pulse
MCP server, which the viewer has added in claude.ai as a connector: it calls the tools the chat
calls, signed in as the viewer, writes nothing, and shows the numbers in the Pulse look, light or
dark, English or German. The template `templates/claude-artifact` gets a process dashboard running
on recorded answers in minutes, and the Claude Code plugin `pulse-artifact` starts Claude on a copy
of it.

## Start from the template

[`templates/claude-artifact`](https://github.com/Miragon/pulse/tree/main/templates/claude-artifact)
holds one example page, a dashboard of the playground's `miraveloLeasing` process: its key
figures, the diagram with its badges, started and ended per day, the end events reached, open
incidents by activity and open tasks, the numbers of the cockpit's process detail in three calls.
Copy the folder out of a clone of the release its pins name on npm; you need Node.js 22.22.2 or
later and pnpm 10.32.1:

<!-- x-release-please-start-version -->

```sh
git clone --depth 1 --branch v0.33.0 https://github.com/Miragon/pulse
cp -r pulse/templates/claude-artifact my-dashboard
cd my-dashboard
pnpm install
pnpm dev
```

<!-- x-release-please-end -->

`pnpm dev` serves the page on the recorded answers in `fixtures/`, with no engine and no server.
The template's [README](https://github.com/Miragon/pulse/tree/main/templates/claude-artifact#readme)
takes it from there: a dashboard of your own process, its answers recorded from your engine with
`pnpm record`, the screenshots, and the publish of the three files `pnpm build` writes, after which
the artifact declares the `mcp` capability with the tools the page calls. The template's
`CLAUDE.md` holds the rules an AI agent follows on a copy: the artifact runtime, the data rules,
the look and the checklist up to the publish.

The page reads the process numbers of the Camunda 7 REST API (CIB seven, Operaton, Camunda 7): a
Camunda 8 engine refuses them.

## The Claude Code plugin

The plugin `pulse-artifact` sits in the plugin marketplace `pulse` of this repository, next to
[the CLI's](../cli/agents.md#claude-code-plugin):

```text
/plugin marketplace add Miragon/pulse
/plugin install pulse-artifact@pulse
```

Its skill loads when you ask Claude for a dashboard, view or report on a process engine as a Claude
artifact. It clones the template from the release the plugin names, copies it and hands over to
the copy's `CLAUDE.md` and README, which are written for the libraries that copy pins. The plugin
lives in
[`apps/mcp-server/skills/pulse-artifact`](https://github.com/Miragon/pulse/tree/main/apps/mcp-server/skills/pulse-artifact)
and carries the server's version. Claude Code does not update third-party plugins on its own: after
a release, run `claude plugin marketplace update pulse`, then
`claude plugin update pulse-artifact@pulse`.

## Without a build

A page of a few panels needs no template: it loads pulse-ui's browser bundle from jsDelivr at the
release's version and ships the package's `pulse-ui.css` as its one file. The pulse-ui
[README](https://github.com/Miragon/pulse/tree/main/packages/core/ui#use-in-a-page-without-a-build)
shows how and lists what the bundle and the stylesheet hold.
