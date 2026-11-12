# UI foundation and shared building blocks

- Status: accepted
- Last reviewed: 2026-11-12 (decided: the surfaces share a core up to building blocks, not everything: formats, the engine reads and their rules, the numbers and view models of a feature more than one surface shows, and building blocks on React's API that the webview renders through `preact/compat`; a feature more than one surface shows, boards first, shows the same numbers on every surface; replaces the two UI families of 2026-11-08)

## Context

Pulse shows an engine on three surfaces. The MCP server's widgets are React on `@miragon/pulse-ui`
and widget-shell, cards in an AI chat with a height budget, hand-offs to the chat and a view bundle
every view resource inlines. This extension's webview, which Pulse for Orca shows too, is Preact
with its own components and stylesheets, tabs in the editor next to the models and the code. The
web apps of #573 are planned on React, pulse-ui and widget-shell.

On 2026-11-08 the product owner decided for two UI families: the webview and the MCP widgets share
pulse-ui's framework-free foundation and never a component (E1), the words align and the numbers
stay per tool (E2), and the foundation is pulse-ui's (E4). The basis was an inventory of both UIs
(2026-11-07: six of the cockpit's eleven views with a counterpart here, about 3,000 lines of
presentation written twice, 25 % of the fields and 14 % of the actions in those pairs the same), a
`preact/compat` spike that rendered pulse-ui in the webview at 198,006 B gzip against its ceiling
of 200,000 B, the finding that the MCP view bundle had no room for a shared UI, and the finding
that no feature had been built on both sides.

A review on 2026-11-12 checked those facts and found:

- The inventory's numbers and the spike's 198,006 B exist only as prose: no script, branch or
  report reproduces them.
- #595 lowered the MCP view bundle's JS ceiling to the bundle plus 1 % (326,800 to 310,450 B gzip).
  The 10 % rule did not force that step.
- "No feature was built on both sides" was outdated when the record merged: four pair features
  were built on both sides in 2026 Q4 (the running count per element on the diagram, the element of
  each incident, the link from an instance to its process, a count on each instance chip), which
  `docs/vscode/parity.md` logs.
- Measured package sizes (gzip): React 19.3.1 with `react-dom/client` 65,917 B, Preact 11.1.1 with
  its hooks 5,705 B, `preact/compat` 7,050 B.
- A design review of four target architectures (2026-11-12) found that the same numbers on two
  surfaces need a shared builder and shared reads, not shared components alone.
- Boards ([boards.md](boards.md)) are planned for the MCP server and the web apps. The VS Code
  board reads "with incident" two ways today: its counter counts the history with
  `incidentStatus=open` (`packages/connectors/c7/c7-adapter/src/reading/instance-search.ts`), its
  incident summary and its engine strip scan the runtime incidents
  (`packages/connectors/c7/c7-adapter/src/reading/definition-reader.ts`).

## Decision

The product owner decided on 2026-11-12. D1 replaces E1, D2 amends E2, D3 keeps E4.

- **D1, one core up to building blocks.** The surfaces (this extension and Pulse for Orca, which
  show one webview; the MCP server's widgets; the web apps of #573) share a core up to building
  blocks, not everything. It has four layers:
  1. Formats, the board file first.
  2. The engine reads and their rules: the Camunda 7 rules live in `@miragon/pulse-c7-core`, which
     the MCP server and the C7 adapter already run over their `EnginePort`.
  3. The numbers and view models of a feature more than one surface shows, built once and
     framework-free over the read models of `@miragon/pulse-engine-core`.
  4. Building blocks: components written against React's API that take props and callbacks only,
     with no host context inside (no `useToolQuery`, `ConfirmDialog`, `HandOffButton` or
     `HostBridge`), which the MCP widgets and the web apps render in React and the webview renders
     through `preact/compat`.

  Each surface keeps its own screens and its host wiring (hand-offs to the chat, live updates and
  the push protocol, native confirmations, sign-in) and may build parts of its own. Where two
  surfaces show the same thing, a shared building block is the default; no surface is forced to
  replace a screen of its own.

- **D2, one builder over one read (amends E2).** A feature more than one surface shows, boards
  first, shows the same numbers on every surface: one builder over one read. Elsewhere E2's numbers
  per tool stay until a view moves onto shared numbers: this extension counts instances and root
  incidents, over every version in the engine overview and the Engines tree and per version in a
  process panel, the MCP widgets every open incident over every version. The words stay aligned
  (`COUNT_TERMS`): "Incidents" are the open incidents of the thing shown, "With incident" the
  instances that have one, and a count's header names its version scope.
- **D3, the foundation stays pulse-ui's (keeps E4).** Two framework-free subpaths,
  `@miragon/pulse-ui/tones` (the tone vocabulary, `SITUATION_TONES`, `countTone`, `severityTone`)
  and `@miragon/pulse-ui/format` (dates and times to the millisecond, relative times, durations,
  counts exact, at least or unknown, `shortId`), and `@miragon/pulse-ui/testing` (the glossary,
  `COUNT_TERMS`, the brand gates) in tests. In addition the webview may import pulse-ui's React kit
  and its stylesheet for shared building blocks. The runtime view's core, ports, model reader and
  host kit stay framework-free: of pulse-ui only `./tones` and `./format`, as before.
- **D4, Preact stays the webview's runtime.** The webview keeps Preact as its runtime and for its
  own screens; the component API of a shared building block is React's.
- **D5, the owner decides.** Decisions about shared building blocks are the product owner's and go
  through normal review. No separate consent of a surface's author is required.
- **D6, #586 is answered.** Its first trigger fired: four pair features were built on both sides in
  2026 Q4, and boards are planned for the MCP server and the web. The triggers and the quarterly
  look drop. `docs/vscode/parity.md` keeps listing what still differs between the pairs; its log of
  the features built on both sides may stay as history.
- **D7, engineering preconditions.** Before the first shared building block renders in the
  webview: the `preact/compat` alias in the webview's esbuild build; pulse-ui's `theme.css` honours
  `data-cd-theme`, `data-cd-kontrast="hoch"` and `forced-colors`; Tailwind without preflight,
  scoped to the shared blocks; the blocks' tests also run under `preact/compat`; the webview's
  bundle ceiling (200,000 B gzip, shrink-only) may grow with a `Ratchet-Exception:` trailer that
  names the block. These are tasks, not a gate on the decision.
- **D8, homes.** The board format and the board builder go into a new published package, planned
  as @miragon/pulse-board; its dependency rules arrive with the package. Shared building blocks go
  into pulse-ui (primitives) or into a shared package created with the first engine block two
  surfaces render. Until then the cockpit side keeps its content of props and callbacks in the
  connector, as the build rule of a pair feature says.

The small form questions settled on 2026-11-08 stay for both tools: no green "healthy" (running
info, suspended and ended neutral, an engine whose verdict is ok too), 12 px icons beside dense
text and on the diagram's overlays as a named deviation, one duration form (`3m 7s`, `1d 3h`), short
ids of numbers by their tail, `≥ 2,000` exact and `10k+` compact (`1.5M` for a million), English
with a 24-hour clock here, one em dash for a missing value ([user-interface.md](user-interface.md)).

## Consequences

- The runtime view's closed world follows D3, changed with this record. The ports, the core, the
  model reader and the host kit stay framework-free: the core imports `./tones` and, in its label
  helper (`core/views/labels.ts`), `./format`; the ports, the model reader and the host kit import
  nothing of pulse-ui; `pulse-ui-only-its-foundation` keeps pulse-ui's React kit, its stylesheets
  and `./testing` out of them. The webview answers to `webview-pulse-ui-by-its-entries`: it imports
  `./tones`, `./format` from its `format/` folder and, for shared building blocks, pulse-ui's root
  (the React kit) and `@miragon/pulse-ui/theme.css`; never `./testing`, `globals.css` (Tailwind
  with its preflight) or `fonts.css`, never another subpath. No layer reaches a file of pulse-ui by
  path, and the repository's `ui-foundation-entries-import-nothing` keeps `./tones` and `./format`
  free of React, Radix and every other import ([guardrails.md](guardrails.md) lists the gates: the
  word scan, the tone table, the brand gates, the date and number gates, the token drift test).
- The preconditions of D7 are tasks with a home each: the alias in the webview's esbuild options,
  which both hosts build with (`packages/core/runtime-view/scripts/webview-build-options.mjs`), the
  attributes and `forced-colors` in pulse-ui's stylesheet (`packages/core/ui/src/theme.css`),
  Tailwind without preflight for the shared blocks, a test run of the blocks under `preact/compat`,
  and the ceiling in `apps/vscode/test/__golden__/bundle-budget.json`. Until they are done, no
  shared building block renders in the webview. `preact/compat` adds about 7 KB gzip to the Preact
  the webview ships; React with `react-dom/client` would add about 66 KB.
- Per surface stays: the webview's own screens, its table, its diagram runtime, the push protocol
  and live updates, English and the native confirmation; the MCP widgets' hand-offs to the chat,
  their height budget, the host contexts and `ConfirmDialog`; each surface's sign-in. A shared
  building block takes these in as props and callbacks.
- Until the first shared building block lands, a pair feature is still built on each side, each
  with its own tests; on the MCP side its content takes props and callbacks without host context
  and stays in the connector (D8).
- Boards move first. Before they move onto one builder over one read, the board's two readings of
  "with incident" (the counter's history count and the incident summary's runtime scan) settle to
  one; which one is open. Two owner decisions fall due then too: the board package's home (under
  `packages/core` with an exception like the runtime view's, or a role-suffixed package of the
  engine family) and whether the engine connector may import engine-core's read models before it
  serves a second dialect.
- Outside boards and the views that move onto shared numbers, users of both tools still see
  different numbers for the same process, under the same words.

## Decision log

2026-11-07: an inventory of both UIs, three designs (one UI, content building blocks, the
foundation only) and a review that corrected them. 2026-11-08: the product owner chose the
foundation only, with the words aligned and the numbers left per tool (E1, E2, E4); built in five
steps: the words, the tones, the formatters, the gates over the webview, and this record with the
parity list. That record planned a review of its pull request by a second author of the webview;
the owner dropped that requirement on 2026-11-12. 2026-11-12: a review of the 2026-11-08 record's
facts and a design review of four target architectures; the product owner decided D1 to D8: a core
shared up to building blocks, the same numbers for a feature more than one surface shows, building
blocks on React's API that the webview renders through `preact/compat`, and #586 answered.
