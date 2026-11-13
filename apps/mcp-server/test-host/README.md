# Widget host simulation (`pnpm --filter @miragon/pulse-mcp-server test:host`)

Playwright gate for the **built** widget bundle, run in CI as "Widget host
simulation (test:host)". It renders exactly what an MCP Apps host renders:

- `global-setup.ts` boots the real composition root (`createApp` from
  `src/app.ts`, default read-only deployment, plus a `engine:operations`
  one for the write scenario and one whose second profile the server refuses,
  its secret's variable unset, at `HOST_SIM_REFUSED_URL`) serving
  `dist/mcp-app.{js,css}`, a CIB seven REST stub (`stub-engine.ts`,
  `fixtures/process-definitions.json` with their statistics and no open incident, the `invoice`
  diagram `fixtures/invoice.bpmn` with two instances at `approveInvoice` and twelve started in
  the last 30 days in its history, five failed jobs, their backlog counts, one invoice instance
  with two open incidents that only its own reads see; under
  `/realistic`, real-sized data in `realistic-engine.ts`) and the host's
  server side (`host-backend.ts`, a real MCP client), all on ephemeral
  loopback ports. A scenario can hold the stub's answers to one search term
  and release them later (`POST /__control/hold|release?term=<term>` at
  `HOST_SIM_ENGINE_URL`), so an in-flight state is asserted without a timing
  window.
- `host-sim.html` is a minimal SEP-1865 host. It reads the view resource
  (`resources/read` of the tool's `_meta.ui.resourceUri`: `ui://views/<tool>.html`,
  the inline document the boot serves, or a module's own), renders it as `srcdoc`
  in a `sandbox="allow-scripts"` iframe
  under the CSP built from the resource's `_meta.ui.csp`, answers
  `ui/initialize`, and proxies every `tools/call` the view makes to the server.
- A scenario can size the frame (`width=<px>`; default 960): the layout
  scenarios render at the 760 px a chat gives an inline view.
- The rendering tool is the real `engine_open_cockpit` against the stub,
  opened on its overview unless a scenario names a `view` (the jobs, a process
  for the BPMN scenario, the instances on the realistic engine for the
  in-widget query; the write one: the failed jobs on the operations
  deployment), so the view gets the server's real `structuredContent` and data
  shape (the view picked by the name its document's prelude sets).

| Scenario                   | Host behaviour                                    | Pass criterion                                                                                                                                                     |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| keep                       | result WITH `structuredContent`                   | the overview's table renders, the prelude names the view, **zero** re-executions, no "Reloaded at", no console error                                               |
| in-widget query            | instances (realistic engine), user types a search | feed refetches + filters (`dedupe`); in flight: focus kept, rows marked; then the matching rows and their filtered total                                           |
| strip                      | result WITHOUT `structuredContent` (claude.ai)    | **exactly one** re-execution with the invocation's arguments, then renders with "Reloaded at"                                                                      |
| slow tool                  | result 4 s after `initialized`                    | waits for the host's result (no timer re-runs the tool), renders once, **zero** re-executions                                                                      |
| `isError`                  | real engine 503 through the server                | **zero** re-executions, the kit's words (`describeError`), raw text under Details, a retry                                                                         |
| cancel                     | `ui/notifications/tool-cancelled`                 | cancellation text, **zero** re-executions                                                                                                                          |
| dark host + dark OS        | `theme: "dark"`, OS dark                          | dark tokens (control for the scenario below)                                                                                                                       |
| dark host + light OS       | `theme: "dark"`, OS light                         | the host wins: `.dark`, `data-theme`, `color-scheme` dark, light text (#339)                                                                                       |
| light host + dark OS       | `theme: "light"`, OS dark                         | the host wins the other way: all three light, dark text                                                                                                            |
| no fullscreen              | `availableDisplayModes` `["inline"]` / absent     | no Fullscreen button (the frame gates it on `availableDisplayModes`), no request                                                                                   |
| host locale `de-DE`        | `locale: "de-DE"`                                 | German widget and chrome strings, `<html lang="de">` (#339)                                                                                                        |
| slow handshake             | `initDelayMs: 3000`                               | nothing painted before `ui/initialize` is answered, then the German, dark view                                                                                     |
| host font                  | `styles.variables["--font-sans"]`                 | stack Geist → host font → system, ids Geist Mono → monospace                                                                                                       |
| served stylesheet          | —                                                 | no forced or inlined font (Geist by URL from the font route), no 600 px floor, the `--cd-*` values                                                                 |
| fonts allowed              | the frame's CSP from `_meta.ui.csp`               | body text DRAWN in Geist, ids in Geist Mono (CDP), each file once from `/fonts/geist-<v>/`                                                                         |
| fonts blocked              | `resourceDomains=ignore` (CSP without them)       | faces fail, the host's font is drawn, rows and height within 5 % of the Geist render                                                                               |
| font route unreachable     | the font requests are held, never answered        | the list paints at once in the fallback (`font-display: swap`), nothing waits                                                                                      |
| height budget              | `containerDimensions.maxHeight: 220`              | settled report ≤ 220 and ≥ the capped container, the shell scrolls inside it                                                                                       |
| list fits a 600 px budget  | the jobs, `containerDimensions.maxHeight: 600`    | the list view fits as a card: exactly three of the five job rows, the shell's container has no scroll of its own (#396)                                            |
| inline fit, real-sized     | realistic engine, 760 px, 600/800/none, de-DE     | instances (all, scoped) and jobs fit as one card: k of N rows, "Show all" in view, no inner scroll; a new budget or width at runtime refits (`inline-fit.spec.ts`) |
| inline head, cross-engine  | the overview's matrix, its own height less 20 px  | the last table cut ("1 of 3 shown" or "2 of 3"); Show all requests fullscreen (all 3), without it Show more (#396, `fleet.spec.ts`)                                |
| bundle budget              | the built `dist/mcp-app.js` / `.css`              | gzip within `test/__golden__/bundle-budget.json`, and within 10 % of it (#344 K39)                                                                                 |
| inline list height         | the jobs, no height budget                        | the settled report (equal to max-content) below the old 600 px floor (#339 K40)                                                                                    |
| fullscreen                 | `availableDisplayModes: ["inline", "fullscreen"]` | the toggle requests fullscreen and follows the host's switch                                                                                                       |
| BPMN on a dark host        | a process (`invoice`), `theme: "dark"`            | light canvas, dark flows/labels, every zoom button clickable past the logo                                                                                         |
| process flow, Running      | a process (`invoice`), its flow on Running        | only the engine's modes, the real feed's count as a badge on `approveInvoice` (2), its row under "Values per activity"                                             |
| process flow, Throughput   | a process (`invoice`), its flow on Throughput     | the real feed's history reads (12 instances, 1 version), the heat painted in the theme's ramp, `approveInvoice`: 10 passes, 2 running                              |
| kit foundation             | the jobs, fullscreen offered                      | Miragon roles (link `--cd-blau-link`), Lucide stroke 2.5 at every size, neutral KPI                                                                                |
| forced colours             | the overview, `forcedColors: "active"`            | the current head section ringed in Highlight, a status dot in CanvasText, not Canvas                                                                               |
| high contrast              | the jobs, `data-cd-kontrast="hoch"` on `<html>`   | the focus ring 3 px (2 px without), the shadow roles transparent                                                                                                   |
| layout at 760 px           | `width: 760` (a chat's inline column)             | no horizontal document scroll, the table in a named region, the 12 px gutter as shell padding                                                                      |
| column priority            | the jobs at 760 px                                | `hideBelow` column hidden, the row actions `sticky` and inside the region                                                                                          |
| row menu                   | the jobs at 760 px, "more" on a middle row        | the menu lies over the next rows' pinned cells: its entries take the clicks, focus, Escape                                                                         |
| axe                        | overview + jobs, light and dark, 760 px           | zero WCAG 2.1 A/AA violations (`@axe-core/playwright`)                                                                                                             |
| instance incidents         | an instance (`pi-invoice-42`), its Incidents tab  | each incident's element: the diagram's name over its id, the id where the diagram lacks it; View process opens the process route                                   |
| instance list chips        | instances (realistic engine), With incident on    | the chips count what each lists (160, 54, 10), All and Suspended unchanged while With incident is on                                                               |
| write refresh (operations) | the failed jobs, user clicks Retry                | the retry refetches the seeded feed and re-renders, **zero** re-executions                                                                                         |
| cockpit on an engine       | `engine_open_cockpit` with `engine`               | opens on that engine (the head's engine select), not on the engine picker                                                                                          |
| cockpit start view         | `engine_open_cockpit` with `view: "jobs"`         | the Jobs head section is current, the jobs table renders, no engine picker                                                                                         |
| cockpit picker             | `engine_open_cockpit` without `engine`            | the engine list (two engines, no default engine configured), each engine's state in its accessible name                                                            |
| cross-engine overview      | the picker's "Cross-engine overview" at 760 px    | the landscape from both engines: column groups headed, backlog columns in their region, the 503 engine "unreachable" with no column; en, de (`fleet.spec.ts`)      |
| axe (cross-engine)         | the overview, light and dark, 760 px              | zero WCAG 2.1 A/AA violations (`fleet.spec.ts`)                                                                                                                    |
| a module's own view        | a tool bound to a resource of its module          | the finished document renders from that URI under its own CSP, no prelude, its feed answers through the host (`own-view.spec.ts`)                                  |
| refused profile            | the picker, one profile refused                   | the refused engine reads "profile refused", opening it says why in en and de, `engine_open_cockpit` on it opens the picker (`refused-profile.spec.ts`)             |
| refused login              | the picker, engines that answer 401 and 403       | "credentials rejected", "access denied", a key (en, de), not "unreachable"; counted apart as a warning, never "not answered" (`refused-login.spec.ts`)             |

**The cockpit's chrome inline.** Every scenario of the engine module renders the cockpit, whose head
(sections, engine switch, Refresh) sits above the route. Inline the head is the only row: a
drilled view's breadcrumb takes the sections' place, a head section shows none. Under the compact
look a 600 px budget then shows three of the five job rows and one of the overview's three
definitions (at 760 px none is cut: not even one row would fit); the host scenarios pin both
counts. The width refit (`inline-fit.spec.ts`) and the row menu run at 800 px, where all five
jobs fit.

Height checks read the **settled** report, the one equal to the document's current
max-content height: auto-resize reports one frame late, so right after the content becomes
visible the last report can still be an earlier state's (the view's loading state).

**Pinned scenarios** assert the CURRENT behaviour of a known defect outside
this repo's fix scope. They fail on purpose once the fix lands: flip them to
the expected behaviour named in their assertion message.

Run it after `pnpm build` (the server imports the workspace packages' dist):

```bash
pnpm --filter @miragon/pulse-mcp-server exec playwright install chromium   # once
pnpm --filter @miragon/pulse-mcp-server test:host                          # builds the UI, then tests
```

Not part of `pnpm test` (needs the Vite bundle and a browser). Run it locally for
any change to the widget shell, pulse-ui, `src/ui/` or the `@modelcontextprotocol/ext-apps` pin.
Failed scenarios leave a trace and a screenshot in `apps/mcp-server/test-results/`
(`pnpm exec playwright show-trace <zip>`).
