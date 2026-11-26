# Claude artifact on Pulse

A template for a live page in claude.ai, a Claude artifact, that reads a process engine through
the Pulse MCP server: the viewer has added the server in claude.ai as a connector, and the page
calls its tools, signed in as the viewer. The page is React on `@miragon/pulse-ui`, in the Pulse
look, light and dark, English and German.

The example is a dashboard of the playground's `miraveloLeasing` process: its key figures, the
diagram with its badges, started and ended per day, the end events reached, open incidents by
activity and open tasks, the numbers of the cockpit's process detail in three calls. `CLAUDE.md`
holds the rules for an AI agent working on a copy, and the Claude Code plugin `pulse-artifact`
starts Claude on one ([Claude artifacts](https://miragon.github.io/pulse/mcp/claude-artifacts)).

## Start in under 10 minutes

You need Node.js 22.22.2 or later and pnpm 10.32.1. Copy the folder out of a clone of the release
its pins name: the template builds on that release's libraries from npm, which `main` may already
have moved past.

<!-- x-release-please-start-version -->

```sh
git clone --depth 1 --branch v0.34.0 https://github.com/Miragon/pulse
cp -r pulse/templates/claude-artifact my-dashboard
cd my-dashboard
pnpm install
pnpm dev
```

<!-- x-release-please-end -->

`pnpm dev` serves the page on the recorded answers in `fixtures/`, replayed in place of the
artifact's connector (`fixtures/dev.tsx`), so it needs no engine and no server. `?lang=de` shows
it in German, `?fail=engine_process_stats` fails that tool with a server's error,
`?fail=needs_reauth` refuses every call with that code, `?fail=engine_process_stats:unavailable`
refuses one tool, and `?delay=800` shows the loading states. The codes are the page's (the table
under [Publish](#publish) maps the runtime's onto them).

| Command                       | What it does                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm dev`                    | The page on the fixtures, reloading on every change                                   |
| `pnpm record`                 | One load's three calls against a Pulse MCP server, written to `fixtures/<key>.json`   |
| `pnpm shot`                   | Screenshots in light, dark and the OS's dark, at 1240 and 390 px, into `shots/`       |
| `pnpm build`                  | `dist/index.html`, `dist/app.js` and `dist/pulse-ui.css`, the three files you publish |
| `pnpm typecheck`, `pnpm test` | Types, the data rules, the page on the fixtures, the bundle and the brand gates       |

## Your own process

1. Set `PROCESS_KEY` in `src/page.config.ts` to your process's key, and the page's title in
   `src/page.html`.
2. Record your engine's answers. In a clone of the Pulse repository, `pnpm play` starts the
   playground's engine and serves the Pulse MCP server at `http://localhost:8400/mcp`; for another
   server set `MCP_URL`, and `MCP_TOKEN` when it asks for a bearer token:

   ```sh
   pnpm record                      # the key of src/page.config.ts
   pnpm record -- --process orders  # another key
   ```

   The recorder (`scripts/record.ts`) runs every read once, the clock fixed at its start and the
   days in this machine's time zone (`--time-zone Europe/Berlin` names another). Ids change with
   every start of an engine: record the whole dashboard again rather than join two recordings,
   then delete `fixtures/miraveloLeasing.json`. A recording holds the engine's answers as they
   came: record against a test engine, or leave it out of what you commit.

3. Edit the sections in `src/sections/`. Their reads live in `src/data/process-dashboard.ts`,
   which the recorder runs too: record again after you change a read.
4. Look at the page: `pnpm exec playwright install --with-deps chromium` once, then `pnpm shot`
   (and `pnpm shot -- --locale de`), and check every screenshot in `shots/`. Where Playwright
   cannot download its Chromium, `CHROME_PATH=/usr/bin/google-chrome pnpm shot` takes yours.
5. `pnpm build`, `pnpm typecheck` and `pnpm test`.

## How the page reads

The page reads through widget-shell's page reads, which its README describes ("A page's reads"
and "A Claude artifact" in `node_modules/@miragon/pulse-widget-shell/README.md`).
`src/artifact.tsx` mounts the page with `mountClaudeArtifact`, whose caller alone knows the
artifact runtime: it calls a tool on the viewer's connector named `CONNECTOR_NAME`. Each section
reads with `useSectionRead`, its key naming what it reads, so sections with one key share one read;
a call is kept 30 seconds and shared among the sections that show it, and a failure is worded in
English and German. `PageGate` says a refusal of the connector once for the page, and
`usePageReads` gives the bar its Refresh and freshness. `src/page.config.ts` lists `PAGE_TOOLS`,
every tool the page calls, and `src/data/process-dashboard.ts` the three reads.

`engine_process_stats` counts the last 14 days of the viewer's time zone, a bucket a day. The page
names no engine, so the server reads its default one; on a server with several and no default, name
`engine` in each read's arguments. The server reads with the cockpit's builders and keeps each
answer 30 seconds per caller. The reads are Camunda 7's (CIB seven, Operaton, Camunda 7): a Camunda
8 engine refuses them.

## Publish

1. Set `CONNECTOR_NAME` in `src/page.config.ts` to the display name of the Pulse connector in
   claude.ai (Settings, Connectors).
2. `pnpm build`, then publish `dist/index.html` as the artifact's page with `dist/app.js` and
   `dist/pulse-ui.css` as its files.
3. After the first publish, declare the `mcp` capability as
   `{ "mcp": { "servers": [{ "server": "<CONNECTOR_NAME>", "tools": [<PAGE_TOOLS>] }] } }`, with
   exactly the tools of `PAGE_TOOLS` in `src/page.config.ts`. The runtime refuses a call to a
   tool it does not name.

The runtime's refusals reach the page as pulse-ui's page error codes, which `?fail=` takes too;
what the viewer is told for each is widget-shell's (its README's "A Claude artifact"):

| The runtime's code                           | The page's code     |
| -------------------------------------------- | ------------------- |
| `needs_reauth`                               | `needs_reauth`      |
| `server_not_connected`, `selection_required` | `not_connected`     |
| `not_in_manifest`, `blocked_by_policy`       | `not_allowed`       |
| `approval_required`                          | `approval_required` |
| `server_unavailable`                         | `unavailable`       |

A tool's own error and any other code reach the page as the server's error, which widget-shell's
`describeError` words; `?fail=<tool>` fails a tool so.

## Rules the tests hold

ESLint does not reach a template, so `test/brand.test.ts` runs pulse-ui's brand gates over
`src/`: colours by role only, Lucide icons at 16 or 24 px, the type scale, the voice rules and the
product's words in both catalogs, and no class beyond `pulse-ui.css`. The theme's contrast in
light and dark is pulse-ui's to hold, since a page cannot change it.
`test/app.test.tsx` mounts the page as the artifact does on the fixtures and holds a load to three
calls, `test/bundle.test.ts` `dist/app.js` to one classic script without the MCP client or the
fixtures. How a section reads, the gate, the Refresh and the runtime's caller are widget-shell's,
held by its own tests. `CLAUDE.md` names the rules a test cannot hold.
