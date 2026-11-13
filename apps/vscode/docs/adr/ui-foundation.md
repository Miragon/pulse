# UI foundation and shared building blocks

- Status: accepted
- Last reviewed: 2026-11-12, later the same day (decided, D9: the webview moves from Preact to React 19 on `@miragon/pulse-ui` in one switch, without a `preact/compat` bridge; one compact look for every surface, on density roles over the guide's `--cd-shell-*` tokens and pulse-ui's colour roles on the guide's `--cd-ui-*` roles, numbers neutral; replaces D4 and turns D7 into the switch's preconditions); 2026-11-12 (decided: the surfaces share a core up to building blocks, not everything: formats, the engine reads and their rules, the numbers and view models of a feature more than one surface shows, and building blocks on React's API; a feature more than one surface shows, boards first, shows the same numbers on every surface; replaces the two UI families of 2026-11-08)

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

Later the same day two studies looked at the look of the surfaces and at the webview's runtime:

- A spec of one look for every surface (four studies: the webview's patterns, pulse-ui's scale, the
  Miragon guide, the effects on the MCP widgets and the web apps; a designer; two judges, one for
  use and accessibility, one for the brand) found the webview's compact sizes on the guide's own
  shell ladder (`--cd-shell-zeile` 40 px, `--cd-shell-eintrag` 36, `--cd-shell-ziel` 32,
  `--cd-shell-rand` 12), which pulse-ui vendors and does not use; pulse-ui's neutral roles on
  lifts of its own where the webview reads the guide's `--cd-ui-*` roles (dark muted text about
  5:1 against 8.8:1); and counts the webview draws red or orange, against invariant 6.
- A plan to move the webview onto pulse-ui (four readers, a planner, two judges for feasibility
  and for use and accessibility) found 64 of the webview's 97 source files (5,873 lines) to
  rewrite on the kit, 26 framework-free files that stay, 7 files a plain hook port, and no part of
  widget-shell that fits a renderer of pushed view models (its query hooks, toasts and MCP host).
  Measured (gzip): the webview ships 127,837 B, Preact with its hooks about 5.7 KB of it; React
  with the part of the kit the webview maps onto and 33 Lucide icons 105,478 to 109,472 B; Orca
  builds readable, and without `NODE_ENV=production` React's development build ships (273 KB
  instead of 180 KB). Expected after the move: 210 to 235 KB.

## Decision

The product owner decided on 2026-11-12. D1 replaces E1, D2 amends E2, D3 keeps E4. Later the same
day the owner decided D9, which replaces D4 and turns D7 into the switch's preconditions.

- **D1, one core up to building blocks.** The surfaces (this extension and Pulse for Orca, which
  show one webview; the MCP server's widgets; the web apps of #573) share a core up to building
  blocks, not everything. It has four layers:
  1. Formats, the board file first.
  2. The engine reads and their rules: the Camunda 7 rules live in `@miragon/pulse-c7-core`, which
     the MCP server and the C7 adapter already run over their `EnginePort`.
  3. The numbers and view models of a feature more than one surface shows, built once and
     framework-free over the read models of `@miragon/pulse-engine-core`.
  4. Building blocks: components on React that take props and callbacks only, with no host context
     inside (no `useToolQuery`, `ConfirmDialog`, `HandOffButton` or `HostBridge`), which every
     surface renders in React: the MCP widgets and the web apps, and the webview from the switch of
     D9 on (D1 first had the webview render them through `preact/compat`).

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
  and its stylesheet for shared building blocks, and from the switch of D9 on it builds its screens
  on them. The runtime view's core, ports, model reader and host kit stay framework-free: of
  pulse-ui only `./tones` and `./format`, as before.
- **D4, Preact stays the webview's runtime (replaced by D9).** Until the switch of D9 lands, the
  webview keeps Preact as its runtime and for its own screens; the component API of a shared
  building block is React's.
- **D5, the owner decides.** Decisions about shared building blocks are the product owner's and go
  through normal review. No separate consent of a surface's author is required.
- **D6, #586 is answered.** Its first trigger fired: four pair features were built on both sides in
  2026 Q4, and boards are planned for the MCP server and the web. The triggers and the quarterly
  look drop. `docs/vscode/parity.md` keeps listing what still differs between the pairs; its log of
  the features built on both sides may stay as history.
- **D7, the switch's preconditions (since D9).** D7 first listed what had to land before a shared
  building block rendered through `preact/compat`. Since D9 it lists what lands before the switch:
  a Tailwind step in the webview's esbuild build with Tailwind's preflight on (the vendored diagram
  styles stay unlayered above it; done, the entry with its preflight comes with the switch);
  `process.env.NODE_ENV` defined as `"production"` in every build that ships, Orca's readable one
  included (done; a build without `production`, VS Code's watch, smoke and e2e builds and the
  runtime view's dev page while it serves, keeps React's development build for its warnings); one
  React instance, so one `react`, `react-dom`, `lucide-react` and pulse-ui in the bundle, checked
  on its metafile; an accessibility and geometry baseline taken under Preact (tests by role,
  label and `data-part`, an axe run without findings, focus kept through a live update, icon and
  target sizes measured in Chromium); pulse-ui's stylesheet following the editor theme
  (`data-cd-theme`, `data-cd-kontrast="hoch"`, `forced-colors`, reduced motion); pulse-ui's
  density roles. These are tasks, not a gate on the decision.
- **D8, homes.** The board format and the board builder go into a new published package, planned
  as @miragon/pulse-board; its dependency rules arrive with the package. Shared building blocks go
  into pulse-ui (primitives) or into a shared package created with the first engine block two
  surfaces render. Until then the cockpit side keeps its content of props and callbacks in the
  connector, as the build rule of a pair feature says.
- **D9, the webview moves to React on pulse-ui; one compact look for every surface** (later on
  2026-11-12; replaces D4, turns D7 into the switch's preconditions).
  1. **One switch.** The webview, which both editor hosts show, moves from Preact to React 19 on
     `@miragon/pulse-ui` in one commit of the pull request that records D9, with no
     `preact/compat` bridge: Preact, its Lucide glyph copy and the webview's own stylesheets go,
     except the overlay part of `diagram.css`, which stays unlayered so that its high-contrast and
     `forced-colors` rules keep winning; `react`, `react-dom` and `lucide-react` at the
     repository's one pin come, in one instance. The
     webview stays a renderer of the view models the core pushes, so widget-shell stays outside
     the editor hosts' world. The commits before the switch land in pulse-ui and the cockpit and
     prepare the webview under Preact, each green on its own.
  2. **Compact for every surface.** pulse-ui's look follows today's webview, on density roles in
     `rem` in pulse-ui's `theme.css` that a test holds to the guide's shell tokens at a 16 px root:
     a 40 px bar, 36 px toolbars and menu entries, 28 px controls and table rows, 24 px small
     buttons, a 12 px gutter. Compact is the default of every surface (the MCP widgets, the web
     apps, the webview); a comfortable step (36 px controls, 40 px rows and toolbars, a 48 px bar)
     applies under `any-pointer: coarse` and `[data-density=comfortable]`. Density never scales
     type: only inputs take 16 px text, on a coarse pointer, so that iOS does not zoom into a
     focused field, and `[data-density=comfortable]` alone leaves them at 13 px.
     `[data-density=compact]` pins the compact step on a coarse pointer too, so the editors stay
     compact on a touch laptop as VS Code itself does: the webview sets it on its `<html>` with
     the switch. The pin reaches the fields too: their text is a role of its own
     (`--field-text`), which stays 13 px under `[data-density=compact]`.
     Controls and bars take a minimum height, never a fixed one, so text at 200 % does not clip.
     A view's bar (`ViewBar`) keeps one line while its parts fit: its title gives way first, cut
     with an ellipsis down to 6ch, and a toolbar button's label hides under 36rem; a group that
     still has no room (the facts with their ids and links, the actions, the host's meta) moves
     onto a further line instead of being cut or hidden (WCAG 1.4.10), two lines under 30rem. So
     the webview's bar row takes the bar's height from the switch on, 40 px at least instead of a
     fixed row, and its screens keep the bar to one line at editor widths with toolbar buttons,
     where the webview hides the key and the times under 900 px today.
     Dense text is 13 px. The view title is chrome, 13 px at weight 600 in the 40 px bar; 28 px at
     weight 700 stays for the app level (landing, fleet). pulse-ui gets no entry for the editors
     alone.
  3. **The guide's colour roles.** pulse-ui's neutral roles map onto the guide's `--cd-ui-*` roles,
     which the webview reads today: background and muted on grund, card on flaeche, popover on
     flaeche-hoch, accent on hover, border on linie, muted-foreground on text-leise, scrim on
     backdrop; the new roles `--raised`, `--interaction` and `--<tone>-surface` join them. The
     `color-mix` lifts of the chat widgets' dark theme go, which is breaking for starters and
     brands. pulse-ui follows the editor theme on `data-cd-theme`, high contrast on
     `data-cd-kontrast="hoch"` and `forced-colors`. VS Code sets the contrast already
     (modeler-shell's appearance wiring). Orca's theme event reports only light or dark
     (`apps/orca/types/orca/index.d.ts`), so in Orca high contrast reaches the webview through
     `forced-colors`, and its bridge sets `data-cd-kontrast="hoch"` only where Orca reports high
     contrast.
  4. **Numbers stay neutral** (invariant 6) on every surface: an alarming count gets a tone icon
     of its own shape and its meaning as screen-reader text, never a coloured number, a tinted
     tile or a dot alone (`CountFigure`, `CountBadge` as a pill; owner's delegate, 2026-11-13).
     The webview's red and orange counts turn neutral.
  5. **Building blocks in pulse-ui's root.** What the webview draws and the cockpit can use moves
     into pulse-ui's root, and the cockpit uses it: `ViewBar` (back, title, facts, actions,
     access, freshness), `StatusStrip`, `Facts`, `StateLabel` (a tone icon and text, no pill),
     `CountBadge`, `CountFigure`, segments with counts (the cockpit's instance scope and a form's
     yes or no too, owner's delegate, 2026-11-13), `SearchField`, the condition chip, an id with
     its copy button, `LoadingState`, `DataTable` (a sticky head, column sizing, row focus) and form
     primitives (checkbox, textarea, label and field, progress). Only the split pane and the
     widths it and the tables store stay the editor's. The variable condition dialog becomes a
     native `<dialog>` on the kit's roles; the diagram's overlays stay the webview's own.
  6. **Named deviations from the guide**, listed in the design section of the root `CLAUDE.md`:
     28 px controls (buttons, inputs, selects) and clickable 28 px rows, radius sm on labelled
     buttons, 24 px small buttons (in notice strips, to copy, and a table row's actions, so every
     row stays 28 px as in the webview; owner's delegate, 2026-11-13), weight 400 on toolbar
     labels, pill count badges, the docked strip without the 4 px edge; 12 px icons at stroke 2.5
     in a listed set of pulse-ui's files; the diagram's count badges stay solid 20 px pills.
  7. **Budgets and release notes.** Each growth of a shrink-only ceiling the move needs (the
     webview's, the MCP view bundle's, the char budgets) updates the ceiling with a
     `Ratchet-Exception:` trailer that says what it buys; no checker is weakened. The webview's
     ceiling goes to its measured size plus about 5 %, at most 250,000 B gzip; the MCP view
     bundle's JS may grow by about 10 % over 310,450 B. pulse-ui's new look and neutrals are a
     `feat(ui)!` with a `BREAKING CHANGE:` footer; the new look of Pulse for VS Code and Pulse for
     Orca is a `feat` with a clear note.

The small form questions settled on 2026-11-08 stay for both tools: no green "healthy" (running
info, suspended and ended neutral, an engine whose verdict is ok too), 12 px icons beside dense
text and on the diagram's overlays as a named deviation (D9 names them for pulse-ui's listed files
too), one duration form (`3m 7s`, `1d 3h`), short ids of numbers by their tail, `≥ 2,000` exact
and `10k+` compact (`1.5M` for a million), English with a 24-hour clock here, one em dash for a
missing value ([user-interface.md](user-interface.md)).

## Consequences

- The runtime view's closed world follows D3, changed with this record. The ports, the core, the
  model reader and the host kit stay framework-free: the core imports `./tones` and, in its label
  helper (`core/views/labels.ts`), `./format`; the ports, the model reader and the host kit import
  nothing of pulse-ui; `pulse-ui-only-its-foundation` keeps pulse-ui's React kit, its stylesheets
  and `./testing` out of them. The webview answers to `webview-pulse-ui-by-its-entries`: it imports
  `./tones`, `./format` from its `format/` folder and, for shared building blocks, pulse-ui's root
  (the React kit) and `@miragon/pulse-ui/theme.css`; never `./testing`, `globals.css` (an app
  entry without a Tailwind entry of its own; the webview gets its own with the switch) or
  `fonts.css`, never another subpath. No layer reaches a file of pulse-ui by path, and the
  repository's `ui-foundation-entries-import-nothing` keeps `./tones` and `./format` free of React,
  Radix and every other import ([guardrails.md](guardrails.md) lists the gates: the word scan, the
  tone table, the brand gates, the date and number gates, the token drift test). With the switch
  the webview's rendering libraries become `react`, `react-dom` and `lucide-react` instead of
  `preact`; Radix reaches it only through pulse-ui, widget-shell never.
- The preconditions of D7 have a home each: the Tailwind step and the `NODE_ENV` define in the
  webview's esbuild options, which both hosts build with
  (`packages/core/runtime-view/scripts/webview-build-options.mjs`; both done: the step,
  `packages/core/runtime-view/scripts/tailwind-entries.mjs`, compiles only the entries the options
  name, none until the switch, and the licence lists read what such an entry inlines through
  `inlinedStylesheets` of `scripts/third-party-licenses.mjs`); the single-instance check beside
  the bundle ceiling (`apps/vscode/test/architecture/bundle-budget.test.ts`,
  `apps/vscode/test/__golden__/bundle-budget.json`); the baseline in the webview's tests
  (`packages/core/runtime-view/test/webview`); the editor theme and the density roles in pulse-ui's
  stylesheet (`packages/core/ui/src/theme.css`). Until the switch the webview renders no React.
- With the switch, too: `prettier-plugin-tailwindcss` sorts the webview's classes; the webview's
  second vendored copy of the Miragon token stylesheet, `cd-tokens.generated.css`, goes (its
  manifest entry, checksums and drift test follow); `cd-tokens.generated.json`, which the
  renderer's paint test reads, `cd-canvas.css` and the overlay part of `diagram.css` stay for the
  diagram; the licence lists of the .vsix and of the Orca plugin are
  written again; the screenshots are shot again and `docs/vscode/parity.md` follows. The React
  Compiler rules of `react-hooks`' `recommended-latest` come in a commit of their own after the
  switch.
- Per surface stays: the webview's host wiring (the push protocol and live updates, English, the
  native confirmation), its diagram runtime and overlays, the split pane and the widths it stores;
  the MCP widgets' hand-offs to the chat, their height budget, the host contexts and
  `ConfirmDialog`; each surface's sign-in. A shared building block takes these in as props and
  callbacks.
- Until the switch lands, a pair feature is still built on each side, each with its own tests; on
  the MCP side its content takes props and callbacks without host context and stays in the
  connector (D8). After it both sides compose pulse-ui's blocks.
- The look changes on every surface: starters and customer modules see compact controls, 13 px
  dense text and the guide's neutrals; an inline card shows more rows in the same height budget;
  users of Pulse for VS Code and Pulse for Orca see the webview on pulse-ui. Under an MCP host's
  theme the host's colour sets background, card and popover alike (`HOST_TOKEN_MAP` stays), so
  1 px lines part the regions there.
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
blocks on React's API that the webview renders through `preact/compat`, and #586 answered. Later on
2026-11-12: a spec of one compact look for every surface and a plan to move the webview onto
pulse-ui, each judged twice; the product owner decided D9: the webview moves to React 19 on
pulse-ui in one switch without `preact/compat`, compact is every surface's default, pulse-ui's
colour roles map onto the guide's `--cd-ui-*` roles, numbers stay neutral, the webview's building
blocks move into pulse-ui's root, and the deviations from the guide are named. D9 replaces D4, and
D7 lists the switch's preconditions.
