# @miragon/pulse-ui

[![npm](https://img.shields.io/npm/v/@miragon/pulse-ui)](https://www.npmjs.com/package/@miragon/pulse-ui)
[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Miragon/pulse)](LICENSE)

The design kit every Pulse view is built from: React components, the tone model and the Miragon
theme, ready for your own MCP App views and your own React UIs. Below 1.0: pin the exact version
and update all `@miragon/pulse-*` packages together.

## Install

```sh
npm install @miragon/pulse-ui react react-dom lucide-react tailwindcss
```

`react`, `react-dom` and `lucide-react` are required peers; `tailwindcss` is needed for the
stylesheets only, `typescript` for the brand gates under `./testing` only, and `bpmn-js` (pin
`18.31.1`) for the BPMN diagram under `./bpmn` only. `./format`, `./tones` and `./glossary` need
no peer at runtime.

## Minimal example

An app wires three things once: a `LocaleProvider` (the kit's own strings follow its locale,
English without one), a `ToastProvider` (without one `useToast()` shows nothing) and the
formatters' locale with `setFormatLocale` (the browser's until you set it).

```tsx
import {
  Button,
  KpiGrid,
  LocaleProvider,
  ToastProvider,
  WidgetHeader,
  createUseT,
  formatNumber,
  setFormatLocale,
  useToast,
  type Translate,
} from "@miragon/pulse-ui"

setFormatLocale({ language: "de", locale: "de-DE" })

// A translator for your own strings is any (locale, key, params) => string.
const CATALOGS: Record<string, Record<string, string>> = {
  de: { title: "Aufträge", open: "Offen", reload: "Neu laden", reloaded: "Neu geladen." },
  en: { title: "Orders", open: "Open", reload: "Reload", reloaded: "Reloaded." },
}
const translator: Translate = (locale, key) => CATALOGS[locale]?.[key] ?? key
const useT = createUseT(translator)

function Orders() {
  const t = useT()
  const toast = useToast()
  return (
    <>
      <WidgetHeader
        title={t("title")}
        actions={
          <Button size="sm" onClick={() => toast.show({ tone: "success", title: t("reloaded") })}>
            {t("reload")}
          </Button>
        }
      />
      <KpiGrid cells={[{ label: t("open"), value: formatNumber(1234) }]} />
    </>
  )
}

export function App() {
  return (
    <LocaleProvider locale="de" translator={translator}>
      <ToastProvider>
        <Orders />
      </ToastProvider>
    </LocaleProvider>
  )
}
```

Your stylesheet imports Tailwind v4, scans the kit's compiled sources, but not the browser
bundle (React and the icons in it hold words Tailwind reads as classes), and imports the theme
after it:

```css
@import "tailwindcss";
@source "../node_modules/@miragon/pulse-ui/dist";
@source not "../node_modules/@miragon/pulse-ui/dist/browser";
@import "@miragon/pulse-ui/theme.css";
```

Never import `globals.css` next to your own Tailwind entry (two Tailwind layers), and never
`fonts.css` in an MCP App view: an inlining bundler embeds the font files in every view. Serve
the fonts by URL with `fontFaces({ baseUrl })` instead.

## Use in a page without a build

A page with no bundler and no Tailwind, a Claude artifact say, loads the kit and its stylesheet
as two ES modules from the package's `dist/browser/`, on a CDN such as jsDelivr, and ships no file
of its own:

```html
<div id="root"></div>
<script type="module">
  import * as ui from "https://cdn.jsdelivr.net/npm/@miragon/pulse-ui@<version>/dist/browser/pulse-ui.js"
  import "https://cdn.jsdelivr.net/npm/@miragon/pulse-ui@<version>/dist/browser/pulse-ui-css.js"

  const h = ui.createElement
  const incidents = { situation: "openIncident", label: "4 open incidents" }
  const cells = [
    { label: "Running", value: ui.formatCount(1284) },
    { label: "Open incidents", value: h(ui.CountFigure, incidents, ui.formatCount(4)) },
  ]
  const page = h(
    "main",
    { className: "flex flex-col gap-section p-gutter" },
    h(ui.WidgetHeader, { title: "Leasing" }),
    h(ui.KpiGrid, { cells }),
  )
  const root = ui.createRoot(document.getElementById("root"))
  root.render(h(ui.LocaleProvider, { locale: "en" }, page))
</script>
```

- **`pulse-ui.js`** holds React, ReactDOM and the kit, React once: every name of the root entry,
  React's and ReactDOM's public names (`createElement`, `Fragment`, the hooks, `createRoot`,
  `createPortal`, …), the JSX runtime's `jsx` and `jsxs`, `React` and `ReactDOM`, and
  lucide-react's context (`LucideProvider`, `useLucideContext`), which every file beside it shares.
  Take React from it only: a second React from another URL breaks every hook. Without a build there is no
  JSX; `createElement`, as `h` here, writes the same tree. Pin the version you install, as for every
  `@miragon/pulse-*` package below 1.0.
- **`pulse-ui-css.js`** holds the text of `pulse-ui.css` (below), and its import puts it into the
  page as one `<style data-pulse-ui>` at the end of `<head>`, after everything there: after a
  host's skeleton, whose reset it wins over as the linked file does, and before the page's
  content. So a page's own styles, a brand's override ("Your own brand", below) included, stand in
  a `<style>` in its content (`<body>`), never in its `<head>`: in `<head>` the kit's unlayered
  rules (the roles, `color-scheme`, the body's font) would win over the page's rules of the same
  specificity, and a `@layer` the page names first would reorder the kit's layers. A second
  import, of another copy or another version, adds nothing. A Claude artifact in a chat has no
  files of its own and loads stylesheets only inline and from Google Fonts, never from a CDN, so
  import it from the same CDN at the same version as `pulse-ui.js`. A page that ships files of its
  own, one with a build such as the Claude artifact template, links `pulse-ui.css` as one of them
  instead.
- **`lucide.js`** beside it holds every Lucide icon under lucide-react's names, on the same React
  and the same icon context, for a page that draws icons of its own
  (`import { Activity } from ".../dist/browser/lucide.js"`); `pulse-ui.js` holds only the icons
  the kit draws. A `LucideProvider` from either file sets the stroke and size of both, so
  `<LucideProvider strokeWidth={ICON_STROKE}>` gives the kit's icons and the page's own the kit's
  stroke.
- **`pulse-ui-bpmn.js`** beside it holds the BPMN diagram of `./bpmn` (below) with bpmn-js, on the
  same React and the kit's contexts, for a page that draws a process
  (`import { BpmnDiagram } from ".../dist/browser/pulse-ui-bpmn.js"`); it injects its own
  stylesheet, and `pulse-ui.css` holds its classes.
- **The words of `./glossary`** need no bundle: `dist/glossary/index.js` imports nothing, so a page
  imports it as it is (`import { COUNT_TERMS } from ".../dist/glossary/index.js"`).
- **`pulse-ui.css`** is the theme compiled with every class the kit renders and these layout
  utilities, each also under `sm:` and `lg:` (a class outside the kit and this list renders
  nothing):

  | What     | Utilities                                                                                                                                                                                                                                                                           |
  | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Display  | `block`, `inline-block`, `inline`, `flex`, `inline-flex`, `grid`, `inline-grid`, `hidden`, `contents`                                                                                                                                                                               |
  | Flex     | `flex-row`, `flex-col`, `flex-wrap`, `flex-nowrap`, `flex-1`, `flex-auto`, `flex-none`, `grow`, `shrink-0`; `items-`, `justify-` and `self-` with start, center and end, `items-baseline`, `items-stretch`, `justify-between`, `self-stretch`                                       |
  | Grid     | `grid-cols-1` to `grid-cols-12`, `col-span-1` to `col-span-12`, `col-span-full`                                                                                                                                                                                                     |
  | Spacing  | `gap`, `gap-x`, `gap-y` with 0, 1, 2, 3, 4, 6, 8, `gutter` or `section`; `p`, `px`, `py`, `pt`, `pr`, `pb`, `pl` with 0 to 4, 6, 8 or `gutter`; `m`, `mx`, `my`, `mt`, `mr`, `mb`, `ml` with 0 to 4, 6 or 8; `mx-auto`, `ml-auto`, `mr-auto`; `space-x`, `space-y` with 1 to 4 or 6 |
  | Size     | `w-full`, `w-auto`, `w-fit`, `w-1/2`, `w-1/3`, `w-2/3`, `w-1/4`, `w-3/4`, `min-w-0`, `max-w-full`, `max-w-sm` to `max-w-7xl`, `max-w-prose`, `h-full`, `h-auto`, `min-h-0`                                                                                                          |
  | Type     | `text-title`, `text-section`, `text-body`, `text-dense`, `text-small`, `text-left`, `text-center`, `text-right`, `font-sans`, `font-mono`, `font-normal`, `font-semibold`, `font-bold`, `tabular-nums`, `truncate`, `whitespace-nowrap`, `break-words`                              |
  | Roles    | `text-foreground`, `text-muted-foreground`, `text-link`, `bg-background`, `bg-card`, `bg-muted`, `border`, `border-t`, `border-b`, `border-l`, `border-r`, `border-border`, `rounded-sm`, `rounded-md`, `rounded-lg`                                                                |
  | Position | `overflow-hidden`, `overflow-auto`, `overflow-x-auto`, `relative`, `sticky`, `top-0`, `sr-only`                                                                                                                                                                                     |

  It sets the body in the kit's font on the 13 px step, unlayered, so a host's reset before it
  (a Claude artifact's skeleton) does not win. Without a font of the page's own the system font
  renders. Geist is an opt-in by a `<link>` of the page to Google Fonts
  (`family=Geist:wght@400;600;700&family=Geist+Mono:wght@400;600`), through which Google receives
  every viewer's IP address.

The page is light or dark by the root's `data-theme` (`"light"` or `"dark"`), as an MCP host and
a Claude artifact write it. With none of `data-theme`, `data-cd-theme` and `data-theme-mode` on
the root, it follows the OS's setting (`prefers-color-scheme`) with no script of its own. A page
that reads an MCP server through a Claude artifact's connector loads widget-shell's page reads
beside these modules the same way:
[widget-shell's README](https://github.com/Miragon/pulse/tree/main/packages/core/widget-shell#use-in-a-page-without-a-build),
"Use in a page without a build".

## What it provides

| Part                                  | What you get                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitives                            | The shadcn-based `Button`, `Card`, `Table`, `Tabs` (with `TabCount`), `Dialog`, `Alert`, `Input`, `Textarea`, `Label`, `Checkbox`, `Switch`, `Progress`, …                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Components                            | `WidgetHeader` (a view's `ViewBar`, the 28 px hero only with `size="app"`), `KpiGrid` (neutral tiles: no tint, no coloured dot; an alarming count is its value's `CountFigure`; its labels quiet at 400 as a fact's term; a tile that opens a view ends its label with the drill's arrow; a flat header row), `NavTabs` with `NavTab` (a named `nav` between views in the line-tab look: links through `asChild` or buttons, `aria-current`, an icon and a `TabCount` per item, wrapping where it has no room), `StatusBadge`/`CountPill` (a state in words; a count goes into a `StateLabel`, `CountFigure` or `CountBadge`; when the numbers were read goes into the bar's `freshness`), `SectionHeading` (a section's title, 13 px at 600 in the foreground as the webview's, `as` naming its outline level at every call, `"span"` for a card's caption, its hint quiet), `FilterBar` (a `Toolbar` with a `SearchField` and toggle chips), `GroupCard` (a `<button aria-expanded>` around its chevron and title, its summary's other controls beside it; `GROUP_CARD_INSET` lines a further line up with the title), `PagedListFooter` (focus moves on to the first new row after Load more), `EmptyState` (compact by default, `size="page"` for an app surface)/`ErrorState` (the guide's status box), `DrillButton` (a drill outside tables, a card's way into its view: a table row opens itself), `SideNav` with `SideNavGroup`, `SideNavList` and `SideNavItem` (an app's side navigation in the editors' look: a named `nav` of links through `asChild`, named groups, nested items, the current one `aria-current` with its 2 px left edge in `--interaction`, a quiet note in an item's name)                |
| Building blocks from the webview      | Props and callbacks only, no host inside, their words in the kit's catalogs: `ViewBar` (a view's 40 px bar: a host's lead (a page's menu), back (named and titled where it goes with `backLabel`), icon, title, state, facts, actions, the access chip, the host's live control and freshness stamp; it wraps, never drops; `ViewBarSlots` adds a host's lead and its actions to every bar below it), `StatusStrip` (a notice docked under the bar, an alert for danger, actions with a busy state), `Facts` (a description list), `StateLabel` (a state as a tone icon of its own shape and its one word; `iconOnlyBelow` shows a second state's icon alone in a narrow table, its word read out and in its title; a count in a view's header is one too, never a tinted badge), `CountBadge` (a neutral number, an alarming one with a tone icon and words; filled only on a diagram), `CountFigure` (a count as a plain figure, an alarming one with its tone's icon of its own shape and why it alarms in words: a table cell, a fact, a KPI tile), `Toolbar` (the bar of controls above a list), `CopyableId` (an id with a copy button, the copy the host's), `ConditionChip` (a removable, editable filter condition), `LoadingState` (a busy status with a spinner)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| List and form pieces                  | `DataTable` (a sticky head of one-line captions, 28 px rows, a row target that opens on a click or Enter and copies on Ctrl or Cmd+C (text selected in it copies as selected), named by `rowLabel`, a hidden hint telling a screen reader that Enter opens it and what Ctrl or Cmd+C copies (its ID, or a table's `copyHint`), one tab stop and the arrows between rows, `DataTableRow` for a row composed by hand (with `href` a link to what it opens: Ctrl or Cmd with a click or Enter and a middle click open it in a new tab), a selection column through `rowSelection`, a `fill` column that takes the room the others leave, rows composed by hand whose `fit` columns fit their one line as drawn rows do, column sizing through `useColumnSizing` with the widths kept where you say and each sized head named by its caption alone, its grip outlined in `Highlight` under forced colours; the grips, the column menu and the selection box come with those two, so a table without them loads none), `Th`/`Td`, `TableEmptyState`, `NamedId` (one line in a table cell, cut first where the table has no room, the name alone under 28rem), `Icon`, `Section` (a collapsible section, its title the 13 px heading at the level you pass, in the foreground like a `SectionHeading`), `RowCard`, `Field`, `SearchField`, `NativeSelect`, `SegmentedControl`, `LogText` (engine text by its `kind`, a `message` in the sans and the foreground, `code` in mono and quiet, its whole under a disclosure that breaks a long unbroken token anywhere; `line` for a table row: one line, whole in its title and, where its column cuts it, a disclosure that opens on it in the column's width, never widening it) |
| Tone, type and focus                  | The tone model (`TONE_*`, `resolveTone`, `ToneVariant`, and the names of `./tones` below), the type scale (`TYPE_SCALE`, `MICRO_LABEL`, a field's text `FIELD_TEXT`), the focus ring (`FOCUS_RING`, `FOCUS_RING_INSET`; under forced colours an outline while focus is visible, none at rest) and `cn`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Locale, toasts, formatters            | `LocaleProvider`, `useLocale`, `createUseT` and the kit's own catalogs in English and German; `ToastProvider`, `useToast`; the formatters of `./format` below, in the locale `setFormatLocale` sets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Formatters without React (`./format`) | Any runtime, no import: dates and times (`formatTimestamp`, `formatDate`, `formatTime`, `formatClock`, `formatInstant`, `formatRelativeTime`), the one duration form (`formatDuration`: `420ms`, `3m 7s`, `2d 3h`), numbers (`formatNumber`, `formatPercent`, `formatPercentPoints`, `formatPeriod`), counts that may be a lower bound or unknown (`formatCount`: `1,234`, `≥ 2,000`, `—`; `formatCompactCount`: `1.2k`, `10k+`), `shortId` and `truncate`, and the zone they render dates in (`getFormatTimeZone`, the zone a read counts days in), so the framework-free cores (the VS Code extension's core beside its React webview) show a date, a duration or a count as the MCP views do; the root entry exports the same names                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Tones without React (`./tones`)       | Any runtime, no import: the vocabulary (`ToneVariant`, `TONE_VARIANTS`, `resolveTone`, `isToneVariant`), `SITUATION_TONES` (the one tone per situation on an engine: an open incident, a job without retries, a running or suspended instance, a process that runs without a problem, which is never green), an engine's verdict (`VERDICT_TONES`) and a failed read of it (`READ_FAILURE_TONES`), and the count ladder (`countTone`, `severityTone`); the root entry exports the same names                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Komet                                 | `KometMark`/`AppEmptyState` for app-level surfaces only: a landing, a first start, never in a widget                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Fonts and tokens                      | `fontFaces`, `GEIST_FONT_FILES`, `adoptHostFontVariables`, `BPMN_LABEL_STYLE` (bpmn-js's `textRenderer` config: the labels on a BPMN canvas in bpmn-js's own Arial at its sizes, as the modelers draw them), and the tokens as data (`CD_TOKENS`, `ROLE_TOKENS`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Stylesheets                           | `theme.css` (the Miragon theme without Tailwind's entry, over the vendored `--cd-*` tokens of `cd-tokens.generated.css`), `globals.css` (Tailwind, the theme and the kit's sources in one line), `fonts.css` (opt-in Geist, bundled)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Brand gates (`./testing`)             | Node only: `catalogTextFindings` (the voice rules over a message catalog), `scanTypeScale` (the five steps, the 13 px floor, weights 400, 600 and 700 only), `scanGlyphs`, `scanIconSizes` (16 and 24 px; 12 px, `DENSE_ICON_SIZE`, only in the files its `allowDense` names with a reason), `scanColors` and `stylesheetColorFindings` over your sources, `scanOutlines` (`outline-hidden` only under a focus state: anywhere else forced colours paint it as a 2 px frame at rest), `stylesheetShapeFindings` over a stylesheet every view inlines, `contrastFindings` with `toneContrastPairs()` / `ROLE_CONTRAST_PAIRS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Product words (`./glossary`)          | Any runtime, no import, a browser too: `PRODUCT_GLOSSARY` (one word per thing in every Pulse UI, per language each term and the words it replaces), `BARE_PAUSE_RULE_EN` (the strict pause rule for a UI that pauses nothing of its own), `COUNT_TERMS` (the one word per count), and the checks: `glossaryFindings` over a catalog, `blindGlossaryRules`, `unnamedGlossaryTerms`; `./testing` hands out the same names beside `sourceTexts` (a source tree that keeps its words in code as a catalog). The table: [miragon.github.io/pulse/glossary](https://miragon.github.io/pulse/glossary)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

`stylesheetShapeFindings` reports a height floor, a forced or inlined font, a raw colour and a
`--cd-*` token. `contrastFindings` checks WCAG AA in light and dark; `LIGHT_STATUS_EXEMPTION` is
the CI's own exemption for green and amber on light.

The kit is pure React: no MCP SDK, no TanStack Query, no zod and no host. The view runtime that
mounts a view in an MCP host and runs its tool calls is
[`@miragon/pulse-widget-shell`](https://www.npmjs.com/package/@miragon/pulse-widget-shell), which
builds on this kit.

## The product's words

`./glossary` holds the words every Pulse UI uses as data, so a page, an agent and the kit's own
tests read one source. It imports nothing beyond its own files, so it runs in a browser bundle and
in Node alike, and a page checks its own catalog with it:

```ts
import { COUNT_TERMS, glossaryFindings, PRODUCT_GLOSSARY } from "@miragon/pulse-ui/glossary"

const de = { kpiIncidents: COUNT_TERMS.incidents.long.de, stuck: "Tote Jobs" }
glossaryFindings(de, PRODUCT_GLOSSARY.de)
// [{ key: "stuck", text: "Tote Jobs", use: "Jobs ohne Versuche" }]
```

A page that pauses nothing of its own adds `BARE_PAUSE_RULE_EN` to the English rules. Every term,
the words it replaces and the count words are in the generated
[glossary](https://miragon.github.io/pulse/glossary).

## A dashboard page

A page outside a host (a Claude artifact, a page of your own) reads several sources, and each
section can fail on its own. Four pieces keep every such page alike, every word from the kit's
catalogs in English and German:

- `SectionState` renders one section's read from `{ loading, error, data }`: its skeleton only
  after 400 ms (`SKELETON_DELAY_MS`) with its room held, the content, `empty` for a read that
  found nothing, a failure in the `ErrorState` box with the raw text under Details and Try again
  unless it is `permanent`. A refresh keeps the data on screen, its region `aria-busy`; one that
  fails says so inline above the data it keeps. Under a `SectionStateGroup` a failure several
  sections share is said once, by the first, whose Try again reads them all again.
- `PanelGrid` lays out `Panel`s (a card with its `h2` title and scope): one column below 600 px of
  its own width, two (or `columns={3}`) where it has the room, the panels of a row as tall as each
  other; `wide` spans a row.
- `FreshnessStamp` goes into the bar's `freshness`: "As of 14:32", the instant in its title.
- `describePageError` words a failed call by its code (`PageErrorCode`: `needs_reauth`,
  `not_connected`, `selection_required`, `not_declared`, `not_allowed`, `approval_required`,
  `unavailable`, `tool_error`), so a page maps its transport's errors once. The words name no
  transport: pass the connector's name and where the viewer manages it (`place`), the claude.ai
  template passes claude.ai's. `not_declared` (the page declares no connection) and `not_allowed`
  are `permanent`: their hints send the reader to whoever published the page, never to try again.

```tsx
function Tasks({ read }: { read: Read<Task[]> }) {
  const t = useT()
  const messages = useUiMessages()
  const error = read.error && describePageError(read.error, { messages, connector: "Pulse" })
  return (
    <Panel title={t("tasks")} hint={t("allVersions")}>
      <SectionState
        state={{ loading: read.loading, error, data: read.data }}
        onRetry={read.retry}
        empty={<TableEmptyState>{t("noTasks")}</TableEmptyState>}
      >
        {(tasks) => <TaskTable tasks={tasks} />}
      </SectionState>
    </Panel>
  )
}

// The page: its bar with the oldest read, its sections in one group.
<WidgetHeader title={t("title")} freshness={<FreshnessStamp at={oldestRead} />} />
<SectionStateGroup>
  <PanelGrid>
    <Tasks read={tasks} />
    <Incidents read={incidents} />
  </PanelGrid>
</SectionStateGroup>
```

## Charts

Four charts in the Pulse look, React and SVG with no chart library: `BarChart` (bars over days
or categories, grouped, on a fixed axis from zero), `LineChart` (series over time with a
crosshair), `Sparkline` (a KPI tile's trend) and `MeterRows` (labelled rows with a bar in
percent and the figure right aligned, for funnels and shares). Each fills its container's width,
measured with a `ResizeObserver`, and never runs past it, so it fits a 360 px view; the axis
keeps the labels that fit (the latest always) and writes its numbers through the kit's
formatters in the view's locale (`unit`: `"count"`, the default, `"duration"` in milliseconds or
`"percent"`). Values are a `Count`: a lower bound `{ atLeast }` draws to its bound and says
"at least", an unknown `null` draws nothing and is never a 0. You format the point labels
(`formatDate`).

```tsx
import {
  BarChart,
  KpiGrid,
  LineChart,
  MeterRows,
  Sparkline,
  formatCount,
  formatDate,
  type Count,
} from "@miragon/pulse-ui"

interface Day {
  day: string
  started: Count
  ended: Count
  incidents: Count
  medianMs: number | null
}

export function ProcessCharts({ perDay }: { perDay: Day[] }) {
  const points = perDay.map((d) => ({
    key: d.day,
    label: formatDate(d.day),
    values: { started: d.started, ended: d.ended, incidents: d.incidents, median: d.medianMs },
  }))
  return (
    <>
      <KpiGrid
        cells={[
          {
            label: "Started",
            value: formatCount(431),
            trend: (
              <Sparkline
                label="Started per day"
                categoryLabel="Day"
                points={points.map((p) => ({
                  key: p.key,
                  label: p.label,
                  value: p.values.started,
                }))}
              />
            ),
          },
        ]}
      />
      <BarChart
        label="Started and ended per day"
        categoryLabel="Day"
        series={[
          { key: "started", label: "Started" },
          { key: "ended", label: "Ended" },
          { key: "incidents", label: "Open incidents", kind: "incident" },
        ]}
        points={points}
      />
      <LineChart
        label="Median duration per day"
        categoryLabel="Day"
        unit="duration"
        series={[{ key: "median", label: "Median" }]}
        points={points}
      />
      <MeterRows
        label="Outcomes"
        total={412}
        rows={[
          { key: "approved", label: "Approved", value: 301 },
          { key: "rejected", label: "Rejected", value: 63 },
        ]}
      />
    </>
  )
}
```

The colours are the theme's data-viz ramp, one blue from `--cd-blau` to `--cd-info-soft` in a
fixed order: a chart's first series takes `--chart-1`, its second `--chart-2`, both 3:1 on every
surface and told apart by lightness (the second line dashed too), measured in light, dark, high
contrast and under protan, deutan and tritan vision; a series of `kind: "incident"` is red, the
one red a chart draws, and nothing is green. Two series is all the ramp holds at 3:1, so a third
series on the ramp throws: split the chart, or show the shares as `MeterRows`. Under forced
colours the first series draws in the system's text colour, the second hollow (dashed as a
line), incidents in its highlight. A legend names two series or more; hovering a point, or the
arrow keys, Home and End on the focused plot (one tab stop), shows its figures in a tooltip (a
`Sparkline`'s is placed in the window, so a KPI tile's clipping strip never cuts it); a screen
reader reads each chart as a visually hidden table, each value in words ("at least 2,000",
"count unknown"). `MeterRows` shows its figures as text, so it needs neither. Its shares are of
an exact whole: a lower bound's share says so (`≥ 40%`), no part reads as 0 % or as all unless
it is, and a whole that is not exact (`total` a lower bound or unknown, or the rows' sum while a
row is) shows no share at all, its bars comparing the rows.

## The BPMN diagram (`./bpmn`)

A process diagram with Pulse's markers, count badges and legend for any React page, with no host:
no MCP SDK, no TanStack Query, no zod (its tests bundle the entry to prove it). It draws with
bpmn-js, an optional peer only this entry imports, and brings its own stylesheet (the canvas in
the theme, the markers, the badges), so a page imports no CSS for it.

```sh
npm install @miragon/pulse-ui bpmn-js@18.31.1
```

```tsx
import { BpmnDiagram, DiagramLegend } from "@miragon/pulse-ui/bpmn"

export function Diagram({ xml }: { xml: string }) {
  return (
    <>
      <DiagramLegend scope="Badges count every version, drawn on v3." />
      <BpmnDiagram
        xml={xml}
        ariaLabel="Bike Leasing, version 3"
        decorations={[
          {
            elementId: "Activity_DecideOnApplication",
            counts: [{ kind: "running", count: 33 }],
            incident: false,
          },
          {
            elementId: "Activity_SendPolicy",
            counts: [{ kind: "incidents", count: 7 }],
            incident: true,
          },
        ]}
        onSelect={(element, count) => console.info(element.id, count.kind)}
      />
    </>
  )
}
```

- **One badge scheme**, the shared screens': an element's counts sit apart over its top right
  corner, its open root incidents in red, the incidents in the instances it called in a quiet
  badge of their own (never part of its incident count), its running instances in blue; only an
  own root incident outlines the element. `decorations` takes the screens' diagram decorations
  as they are (`DiagramDecorations.of` of `@miragon/pulse-screens`); `markers` outlines an
  instance's wait, open task or incident without a count. An element the drawing lacks is
  skipped without an error.
- **Counts in words.** Without `onSelect` the badges are a drawing and the page says the counts
  elsewhere; with it each count is a button named by its element and its figure, and
  `selectable` draws one that leads nowhere without a button. `nameOf` names an element (default:
  its name in the XML). `renderCounts` draws a surface's own counts in each element's anchor.
- **The frame.** Its height is the diagram's own (240 to 560 px), a fixed `height`, or `"fill"`
  for the box it sits in; `maxHeight` caps it (an MCP view passes widget-shell's
  `useDiagramMaxHeight`). The zoom bar sits top right, bpmn.io's link bottom right, the fit
  keeps the drawing clear of both. The canvas follows the theme: light, dark (`data-theme`,
  `.dark`, or the system's scheme where the page sets no mode), high contrast
  (`data-cd-kontrast="hoch"`) and forced colours.
- **For a drawing of your own**: `useBpmnViewer` with `BpmnZoomControls`, the canvas's tokens
  (`BPMN_TOKENS`, `BPMN_CANVAS_VARS`, `BPMN_OVERLAY_CSS`), `CanvasBadge` (the badge, as the blocks'
  `Badge` slot) and the one BPMN name reader (`readBpmnNames`, `parseBpmnNames`).

## Your own brand

The theme maps role variables (`--primary`, `--interaction`, `--link`, `--focus`, `--<tone>`,
`--<tone>-soft`, `--<tone>-surface`, `--<tone>-ink`, radii, shadows, fonts) onto the vendored
`--cd-*` tokens, in light and dark. The neutrals carry the Miragon guide's `--cd-ui-*` roles:
`--background` and `--muted` its ground (`#F9F7F7` on light), `--card` its surface, `--popover`
and `--raised` its raised surface, `--accent` its hover, `--border` its line, `--muted-foreground`
its quiet text, `--scrim` its backdrop. The mode follows `.dark`, `data-theme="dark"` and the
guide's own `data-cd-theme="dark"`; a root with none of `data-theme`, `data-cd-theme` and
`data-theme-mode` follows the OS (`prefers-color-scheme: dark`), and `data-theme="light"` keeps
it light. `data-cd-kontrast="hoch"` switches high contrast (no shadows, stronger edges and quiet
text, a 3 px focus) and forced colours keep every state visible. Your brand overrides role
variables only, never a `--cd-*` token, under `:root` AND the dark scopes
(`.dark, [data-theme="dark"], [data-theme-mode="dark"], [data-cd-theme="dark"]`), or a light-only
value shows in dark; for a page that follows the OS, also inside
`@media (prefers-color-scheme: dark)` on
`:root:where(:not([data-theme], [data-cd-theme], [data-theme-mode]))`. A page that imports
`pulse-ui-css.js` writes it in a `<style>` in its `<body>`, which comes after the kit's ("Use in
a page without a build", above). Measure it in a test with `@miragon/pulse-ui/testing`:
`parseThemeVariables(...themeStylesheets(), brandCss)` and `contrastFindings` over
`toneContrastPairs()` and `ROLE_CONTRAST_PAIRS`; the values for the OS's dark root are measured
too (`os-dark`), wherever they resolve a pair apart from the dark scopes' values.

The density roles set the size of controls, rows and bars on every surface, compact by default
and in `rem` on the guide's shell ladder (`--cd-shell-zeile` 40 px, `--cd-shell-eintrag` 36,
`--cd-shell-rand` 12 at a 16 px root): `--bar-h` 40 px, `--toolbar-h` and `--entry-h` 36,
`--control-h` 28, `--control-h-xs` 24, `--control-h-lg` 36, `--row-h` 28, `--cell-px` 12 and
`--cell-py` 4, `--gutter` and `--section-gap` 12, `--segment-h` 24, `--badge-h` 20 and
`--button-radius` (sm). On a coarse pointer (`any-pointer: coarse`) and inside an element marked
`data-density="comfortable"` they take the comfortable step: 36 px controls, 40 px rows,
toolbars and menu entries, a 48 px bar, a 16 px gutter, the md radius on buttons. Tailwind reaches
them as spacing keys (`min-h-control`, `h-row`, `size-control-xs`, `p-gutter`, `gap-section`,
`min-h-bar`, `min-h-toolbar`, `min-h-entry`, `h-segment`, `h-badge`), `px-cell` and `py-cell`,
and `rounded-button`; `cn` merges them against Tailwind's own steps. A brand that sets a density
role under `:root` sets it for both steps, since its stylesheet comes after the theme. A host
that stays compact on touch (an editor, as the editor itself does) marks its root
`data-density="compact"`. A field's text has a role of its own, `--field-text` (the `text-field`
utility): 13 px, 16 px on a coarse pointer, where iOS zooms into a focused field with smaller
text, and 13 px again under a host's `data-density="compact"`; `data-density="comfortable"` alone
leaves it at 13 px, since density never scales type.

The kit's controls stand on them: `Button` is 28 px in its default and `sm` sizes, 24 px in
`xs` (in a notice strip, to copy, and a table row's actions, so a row keeps the row height), 36 px in `lg` (a dialog's footer), its icon sizes square, with the sm radius; its
`toolbar` variant (an icon and a label at 400) hides the label visually, never from the
accessible name, inside a bar narrower than 36rem (the container named `bar`: `ViewBar`,
`Toolbar` and `StatusStrip` set it, any other container leaves the label alone), and turns square
around its icon (a toolbar button without an icon keeps its label); a `ViewBar`'s actions show
their labels again under 30rem, where they take a line of their own below the title. A bar runs from edge to edge
of its surface with the gutter at its sides (widget-shell's `WidgetShell` pads only its content,
never its bars), so its controls line up with the content below; a `Toolbar` inside that content
reaches the card's edges with `-mx-gutter`, as a view's tab bar does. A `StatusStrip` keeps an
engine's raw text (`details`) behind a Details button and opens it under its line, outside the
live region, so the strip stays one line until the reader asks. `Facts` sets a term on its
value's baseline. `Input` and `NativeSelect` are
28 px on the ground (`Textarea` too, three lines high at least), `Tabs` with `variant="line"` is
a view's 36 px tab bar (a 2 px `--interaction` bar under the active tab; `TabCount` for a count,
`≥ 2,000` for a capped one and `—` for an unknown one, said in words in the tab's name, both in
the kit's locale; an `aside` at the bar's end, outside the tab list; one line whose tabs scroll
inside the bar where they need more room, the focused tab and the selected one, once drawn and
whenever the selection changes, scrolled into view; under forced colours the list stops on the
bar's rule, so the rule runs whole), `SegmentedControl` is a
radio group of 24 px segments with one tab stop whose arrow keys, Home and End move the check,
each segment with an optional count (compact on screen, exact for a screen reader, both in the
kit's locale), tone icon and note (for a host that passes `busy`, `aria-busy` and the picked
segment checked at once until the value follows or the change ends; `disabled` for a read-only
field, its check kept), a menu entry (`MENU_ITEM`)
is 36 px, and `Icon`'s `dense` is the 12 px icon of the named deviation. `Dialog` is at most 560 px wide in
three parts that carry its spacing: `DialogHeader` (16 px above, 24 px left, 8 px below, the
close button's corner kept clear), `DialogBody` (24 px on the sides and below) and
`DialogFooter` (a rule above, 24 px on the sides, 16 px above and below, its buttons `lg`).
`side="left"` makes it a drawer along the window's left edge (a page's navigation under its wide
layout), 18rem wide at most, with the same scrim, focus trap and Escape.

`Field` wires a label above its control and a hint and an error below it (`htmlFor`,
`aria-describedby`, `aria-invalid` while the error shows): `Input`, `Textarea`, `NativeSelect`,
`Checkbox` and `SearchField` take the wiring by themselves, another control through a function
child. The error says what is wrong next to the control; the entry stays as typed. `Checkbox` is
the guide's 18 px box with a 24 px target, its edge and check in `--interaction` when checked,
a minus for `checked="indeterminate"`. `Progress` is a `progressbar` that needs a name and its
value in words (`valueText`) and fills to its `value` of `max` (100 by default); without a `value`
it runs, and stands still as a dashed line under reduced motion. `SearchField` is a 200 px field with its search icon inside and a clear button:
it calls `onChange` with the trimmed text once typing pauses (`delayMs`, 300 ms), at once on
Enter, the clear button and Escape, and follows its `value` (the search in effect) when that
changes from outside. Its name, placeholder and clear button come from the kit's catalogs
(`searchField`).

## Help and feedback

- **Documentation:** building your own server and views is explained at [miragon.github.io/pulse](https://miragon.github.io/pulse/).
- **Bugs and ideas:** found a bug or missing something? [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How to build, test and change Pulse is in [CONTRIBUTING.md](https://github.com/Miragon/pulse/blob/main/CONTRIBUTING.md).

## License

[MIT](LICENSE) © Miragon GmbH. The primitives build on the components of
[shadcn/ui](https://github.com/shadcn-ui/ui), MIT © shadcn: its licence is in
[src/primitives/LICENSE](src/primitives/LICENSE), which the tarball ships with them. A bundle that
holds them lists it with its licences, as the Pulse server image does.
