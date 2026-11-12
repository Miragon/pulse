# UI foundation

- Status: accepted
- Last reviewed: 2026-11-08 (decided: the webview and the MCP widgets share Pulse's UI foundation, not their components)

## Context

Pulse shows an engine in two UIs. The MCP server's widgets are React on `@miragon/pulse-ui` and
widget-shell, cards in an AI chat with a height budget, hand-offs to the chat and a view bundle
every view resource inlines. This extension's webview is Preact with its own components and
stylesheets, tabs in the editor next to the models and the code. The product owner's goal was the
same React components in both, and a `preact/compat` spike showed that pulse-ui renders here
(light and dark, dialogs, portals, keyboard), at 198,006 B gzip against the 126,503 B the webview
had then (127,051 B with this foundation) and the ceiling of 200,000 B.

An inventory of both UIs (2026-11-07) found:

- Six of the cockpit's eleven views have a counterpart here: the engine overview, a process, its
  instances, an instance, an incident and the history. About 3,000 lines of presentation are
  written twice, at most 3,991.
- Inside those pairs only 32 of 130 fields (25 %) and 13 of 92 actions (14 %) are the same. At
  least 16 differences are decided in these records or in the repository's `CLAUDE.md`: root
  incidents only and counts of instances ([runtime-contract.md](runtime-contract.md)), statistics
  per version against a process view over every version, no state label in the instance header,
  times to the millisecond ([user-interface.md](user-interface.md)).
- The data behind the pairs stays double in any variant: the core of the pair panels has about
  2,572 lines against 1,829 webview lines. A shared UI saves the second presentation, not the
  second reading.
- No feature was built on both sides since the extension came into the monorepo (2026-10-24).

Three variants were weighed: one UI for the six pairs (80 to 130 person-days, the MCP view bundle
without room for it), shared content building blocks (35 to 55, a second runtime for good) and the
foundation only (12 to 17).

## Decision

The product owner decided on 2026-11-08:

- **E1, two UI families.** The webview keeps Preact, its own components and stylesheets, its table,
  its diagram runtime, the push protocol, English and the native confirmation. React stays the one
  component API for the MCP widgets, the starter's widgets and the web apps of #573. The two share
  the foundation, never a component.
- **E4, the foundation is pulse-ui's.** Two framework-free subpaths, `@miragon/pulse-ui/tones` (the
  tone vocabulary, `SITUATION_TONES`, `countTone`, `severityTone`) and `@miragon/pulse-ui/format`
  (dates and times to the millisecond, relative times, durations, counts exact, at least or
  unknown, `shortId`), which core and webview import and esbuild bundles
  ([architecture.md](architecture.md)); `@miragon/pulse-ui/testing` (the glossary,
  `COUNT_TERMS`, the brand gates) only from the tests. No new package.
- **E2, the words align, not the numbers.** "Incidents" are the open incidents of the thing shown,
  "With incident" the instances that have one, and a count's header names its version scope
  (`COUNT_TERMS`). The numbers stay per tool: this extension counts instances and root incidents,
  over every version in the engine overview and the Engines tree and per version in a process
  panel, the MCP widgets every open incident over every version.
- The small form questions, settled for both tools: no green "healthy" (running info, suspended and
  ended neutral, an engine whose verdict is ok too), 12 px icons beside dense text and on the
  diagram's overlays as a named deviation, one duration form (`3m 7s`, `1d 3h`), short ids of
  numbers by their tail, `≥ 2,000` exact and `10k+` compact (`1.5M` for a million), English with a
  24-hour clock, one em dash for a missing value ([user-interface.md](user-interface.md)).
- **A parity list.** `docs/vscode/parity.md` lists every difference between the pairs as closed,
  wanted or open, with its origin (host, engine, a record, history). A feature on a pair follows
  its review rule; once a quarter a maintainer counts the features built on both sides.
- **Re-entry is #586.** It holds when the two UIs share content building blocks again (not whole
  screens) and its triggers: two pair features built on both sides in one quarter, a named customer
  who wants these panels in the web or customer widgets in VS Code, one person who maintains both
  UIs, Camunda 8 back in the MCP server. The first cut then is variable rows, incident facts and
  history rows with neutral callbacks; a shared package only with a second consumer.

## Consequences

- The closed world names the foundation: core and webview import `./tones`, their label helpers
  `./format`, and nothing else of pulse-ui (`pulse-ui-only-its-foundation` in all three shapes an
  import arrives in), and the repository's `ui-foundation-entries-import-nothing` keeps those entries free of
  React, Radix and every other import ([guardrails.md](guardrails.md) lists the gates: the word
  scan, the tone table, the brand gates, the date and number gates, the token drift test).
- The webview stays near 127 KB gzip; the foundation costs about a kilobyte, and the 200,000 B
  ceiling stays a tripwire.
- A feature on a pair is built twice, in Preact here and in React there, each with its own tests.
  On the MCP side its content takes props and callbacks without host context, so a later shared
  building block costs little.
- Users of both tools still see different numbers for the same process, under different words.
- The target architecture's stage of one shared `process-ui` drops.

## Decision log

2026-11-07: an inventory of both UIs, three designs (one UI, content building blocks, the
foundation only) and a review that corrected them. 2026-11-08: the product owner chose the
foundation only, with the words aligned and the numbers left per tool, and to build it before
asking the webview's other author, who reviews the pull request. Built in five steps: the words, the
tones, the formatters, the gates over the webview, and this record with the parity list.
