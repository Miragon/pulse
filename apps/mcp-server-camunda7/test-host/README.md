# Widget host simulation (`pnpm --filter @miragon/pulse-mcp-server-camunda7 test:host`)

Playwright gate for the **built** widget bundle, run in CI as "Widget host
simulation (test:host)". It renders exactly what an MCP Apps host renders:

- `global-setup.ts` boots the real composition root (`createApp` from
  `src/app.ts`, default read-only deployment, plus a `camunda7:operations`
  one for the write scenario) serving `dist/mcp-app.{js,css}`, a CIB seven
  REST stub (`stub-engine.ts`, `fixtures/process-definitions.json` plus the
  `invoice` diagram `fixtures/invoice.bpmn`, three failed jobs), a Prometheus
  stub (`stub-prometheus.ts`: two engines, two processes, the `invoice`
  activities, evaluating the exact PromQL shapes analytics sends) and the host's
  server side (`host-backend.ts`, a real MCP client), all on ephemeral
  loopback ports. A scenario can hold the stub's answers to one search term
  and release them later (`POST /__control/hold|release?nameLike=<term>` at
  `HOST_SIM_ENGINE_URL`), so an in-flight state is asserted without a timing
  window.
- `host-sim.html` is a minimal SEP-1865 host. It reads the view resource
  (`resources/read` of `ui://views/<tool>.html`, mcp-use's synthesized inline
  document), renders it as `srcdoc` in a `sandbox="allow-scripts"` iframe
  under the CSP built from the resource's `_meta.ui.csp`, answers
  `ui/initialize`, and proxies every `tools/call` the view makes to the server.
- A scenario can size the frame (`width=<px>`; default 960): the layout
  scenarios render at the 760 px a chat gives an inline view.
- The rendering tool is the real `camunda7_show_process_list` against the
  stub (the BPMN scenario: `camunda7_show_bpmn_viewer`; the write one:
  `camunda7_show_job_panel` on the operations deployment), so the view gets the
  server's real `structuredContent` and data shape (the view picked by the name its
  document's prelude sets).

| Scenario                   | Host behaviour                                    | Pass criterion                                                                                                                                                     |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| keep                       | result WITH `structuredContent`                   | real table renders, the prelude names the view, **zero** re-executions, no "Reloaded at", no console error                                                         |
| in-widget query            | user types; the stub holds the search's answer    | feed refetches + filters (`dedupe`); in flight: focus kept, rows marked                                                                                            |
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
| list fits a 600 px budget  | `containerDimensions.maxHeight: 600`              | the list view fits as a card: the shell's container has no scroll of its own (#396)                                                                                |
| inline fit, real-sized     | realistic engine, 760 px, 600/800/none, de-DE     | instances (all, scoped) and jobs fit as one card: k of N rows, "Show all" in view, no inner scroll; a new budget or width at runtime refits (`inline-fit.spec.ts`) |
| inline head of a table     | analytics dashboard, `maxHeight: 400` (3 rows)    | 3 of 6 rows and "3 of 6 shown"; Show all requests fullscreen (all 6), without it Show more (#396)                                                                  |
| bundle budget              | the built `dist/mcp-app.js` / `.css`              | gzip within `test/__golden__/bundle-budget.json`, and within 10 % of it (#344 K39)                                                                                 |
| inline list height         | the process list, no height budget                | the settled report (equal to max-content) below the old 600 px floor (#339 K40)                                                                                    |
| fullscreen                 | `availableDisplayModes: ["inline", "fullscreen"]` | the toggle requests fullscreen and follows the host's switch                                                                                                       |
| BPMN on a dark host        | `camunda7_show_bpmn_viewer`, `theme: "dark"`      | light canvas, dark flows/labels, every zoom button clickable past the logo                                                                                         |
| kit foundation             | `camunda7_show_job_panel`, fullscreen offered     | Miragon roles (link `--cd-blau-link`), Lucide stroke 2.5, 2 dense, neutral KPI                                                                                     |
| layout at 760 px           | `width: 760` (a chat's inline column)             | no horizontal document scroll, the table in a named region, 24 px shell padding                                                                                    |
| column priority            | `camunda7_show_job_panel` at 760 px               | `hideBelow` column hidden, the row actions `sticky` and inside the region                                                                                          |
| row menu                   | job panel at 760 px, "more" on a middle row       | the menu lies over the next rows' pinned cells: its entries take the clicks, focus, Escape                                                                         |
| axe                        | process list + job panel, light and dark, 760 px  | zero WCAG 2.1 A/AA violations (`@axe-core/playwright`)                                                                                                             |
| write refresh (operations) | `camunda7_show_job_panel`, user clicks Retry      | the retry refetches the seeded feed and re-renders, **zero** re-executions                                                                                         |
| cockpit on an engine       | `camunda7_open_cockpit` with `engine`             | opens on that engine (the head's engine select), not on the engine picker                                                                                          |
| cockpit picker             | `camunda7_open_cockpit` without `engine`          | the engine list (two engines, no default engine configured), each engine's state in its accessible name                                                            |
| analytics dashboard        | `analytics_show_dashboard` at 760 px              | every activity column shown inside its region, names from the diagram, no document scroll                                                                          |
| analytics landscape        | `analytics_show_engine_landscape` at 760 px       | the column groups headed, the backlog columns and the compare action inside their regions                                                                          |
| axe (analytics)            | dashboard + landscape, light and dark, 760 px     | zero WCAG 2.1 A/AA violations (`analytics.spec.ts`)                                                                                                                |

Height checks read the **settled** report, the one equal to the document's current
max-content height: auto-resize reports one frame late, so right after the content becomes
visible the last report can still be an earlier state's (the view's loading state).

**Pinned scenarios** assert the CURRENT behaviour of a known defect outside
this repo's fix scope. They fail on purpose once the fix lands: flip them to
the expected behaviour named in their assertion message.

Run it after `pnpm build` (the server imports the workspace packages' dist):

```bash
pnpm --filter @miragon/pulse-mcp-server-camunda7 exec playwright install chromium   # once
pnpm --filter @miragon/pulse-mcp-server-camunda7 test:host                          # builds the UI, then tests
```

Not part of `pnpm test` (needs the Vite bundle and a browser). Run it locally for
any change to the widget shell, pulse-ui, `src/ui/` or the mcp-use pin.
Failed scenarios leave a trace and a screenshot in `apps/mcp-server-camunda7/test-results/`
(`pnpm exec playwright show-trace <zip>`).
