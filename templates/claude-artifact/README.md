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
git clone --depth 1 --branch v0.33.0 https://github.com/Miragon/pulse
cp -r pulse/templates/claude-artifact my-dashboard
cd my-dashboard
pnpm install
pnpm dev
```

<!-- x-release-please-end -->

`pnpm dev` serves the page on the recorded answers in `fixtures/`, through a stand-in for the
artifact's connector (`fixtures/mock-claude.ts`), so it needs no engine and no server. `?lang=de`
shows it in German, `?fail=engine_process_stats` fails that tool, `?fail=needs_reauth` refuses
every call with that code of the runtime's, and `?delay=800` shows the loading states.

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

`src/engine/` is the page's one way to the engine. `claude-connector.ts` alone knows the artifact
runtime: it calls a tool on the viewer's connector named `CONNECTOR_NAME`. `engine.ts` keeps each
answer 30 seconds and shares a call among the sections that show it, `errors.ts` words each failure
in English and German, `use-engine.tsx` gives each section a read of its own, and `tools.ts` lists
`PAGE_TOOLS`, every tool the page calls.

`engine_process_stats` counts the last 14 days of the viewer's time zone, a bucket a day. The page
names no engine, so the server reads its default one; on a server with several and no default,
`engineId` of `createEngine` names it. The server reads with the cockpit's builders and keeps each
answer 30 seconds per caller. The reads are Camunda 7's (CIB seven, Operaton, Camunda 7): a Camunda
8 engine refuses them.

## Publish

1. Set `CONNECTOR_NAME` in `src/page.config.ts` to the display name of the Pulse connector in
   claude.ai (Settings, Connectors).
2. `pnpm build`, then publish `dist/index.html` as the artifact's page with `dist/app.js` and
   `dist/pulse-ui.css` as its files.
3. After the first publish, declare the `mcp` capability as
   `{ "mcp": { "servers": [{ "server": "<CONNECTOR_NAME>", "tools": [<PAGE_TOOLS>] }] } }`, with
   exactly the tools of `PAGE_TOOLS` in `src/engine/tools.ts`. The runtime refuses a call to a
   tool it does not name.

What a viewer is told when the runtime refuses a call, by its code:

| Code                                         | What the viewer can do                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `needs_reauth`                               | Reconnect the connector in claude.ai under Settings, Connectors                           |
| `server_not_connected`, `selection_required` | Add the connector in claude.ai under Settings, Connectors, or pick it when claude.ai asks |
| `not_in_manifest`, `blocked_by_policy`       | Ask whoever published the page: it may not read the connector for them                    |
| `approval_required`                          | Allow the access when claude.ai asks, then try again                                      |
| `server_unavailable`                         | Try again: the Pulse MCP server does not answer                                           |
| any other code, and a tool's own error       | Read the server's error, worded by widget-shell's `describeError`                         |

## Rules the tests hold

ESLint does not reach a template, so `test/brand.test.ts` runs pulse-ui's brand gates over
`src/`: colours by role only, Lucide icons at 16 or 24 px, the type scale, the voice rules and the
product's words in both catalogs, and no class beyond `pulse-ui.css`. The theme's contrast in
light and dark is pulse-ui's to hold, since a page cannot change it.
`test/app.test.tsx` holds a load to three calls, `test/bundle.test.ts` `dist/app.js` to one classic
script without the MCP client or the fixtures. `CLAUDE.md` names the rules a test cannot hold.
