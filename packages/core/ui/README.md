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
stylesheets only, and `typescript` for the brand gates under `./testing` only. `./format` and
`./tones` need no peer at runtime.

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

Your stylesheet imports Tailwind v4, scans the kit's compiled sources and imports the theme
after it:

```css
@import "tailwindcss";
@source "../node_modules/@miragon/pulse-ui/dist";
@import "@miragon/pulse-ui/theme.css";
```

Never import `globals.css` next to your own Tailwind entry (two Tailwind layers), and never
`fonts.css` in an MCP App view: an inlining bundler embeds the font files in every view. Serve
the fonts by URL with `fontFaces({ baseUrl })` instead.

## What it provides

| Part                                  | What you get                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitives                            | The shadcn-based `Button`, `Card`, `Table`, `Tabs` (with `TabCount`), `Dialog`, `Alert`, `Input`, `Textarea`, `Label`, `Checkbox`, `Switch`, `Progress`, …                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Components                            | `WidgetHeader` (a view's `ViewBar`, the 28 px hero only with `size="app"`), `KpiGrid`, `StatusBadge`/`LivePill`/`CountPill`, `FilterBar` (a `Toolbar` with a `SearchField` and toggle chips), `GroupCard`, `PagedListFooter`, `EmptyState` (compact by default, `size="page"` for an app surface)/`ErrorState` (the guide's status box), `DrillButton`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Building blocks from the webview      | Props and callbacks only, no host inside, their words in the kit's catalogs: `ViewBar` (a view's 40 px bar: back, icon, title, state, facts, actions, the access chip, the host's live control and freshness stamp; it wraps, never drops), `StatusStrip` (a notice docked under the bar, an alert for danger, actions with a busy state), `Facts` (a description list), `StateLabel` (a state as a tone icon of its own shape and its one word), `CountBadge` (a neutral number, an alarming one with a tone icon and words; filled only on a diagram), `Toolbar` (the bar of controls above a list), `CopyableId` (an id with a copy button, the copy the host's), `ConditionChip` (a removable, editable filter condition), `LoadingState` (a busy status with a spinner) |
| List and form pieces                  | `DataTable` (a sticky head of one-line captions, 28 px rows, a row target, a selection column, a `fill` column that takes the room the others leave, column sizing through `useColumnSizing` with the widths kept where you say), `Th`/`Td`, `TableEmptyState`, `NamedId` (one line in a table cell, cut first where the table has no room), `Icon`, `Section`, `RowCard`, `Field`, `SearchField`, `NativeSelect`, `SegmentedControl`, `LogText`                                                                                                                                                                                                                                                                                                                             |
| Tone, type and focus                  | The tone model (`TONE_*`, `resolveTone`, `ToneVariant`, and the names of `./tones` below), the type scale (`TYPE_SCALE`, `MICRO_LABEL`), the focus ring (`FOCUS_RING`) and `cn`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Locale, toasts, formatters            | `LocaleProvider`, `useLocale`, `createUseT` and the kit's own catalogs in English and German; `ToastProvider`, `useToast`; the formatters of `./format` below, in the locale `setFormatLocale` sets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Formatters without React (`./format`) | Any runtime, no import: dates and times (`formatTimestamp`, `formatDate`, `formatTime`, `formatClock`, `formatInstant`, `formatRelativeTime`), the one duration form (`formatDuration`: `420ms`, `3m 7s`, `2d 3h`), numbers (`formatNumber`, `formatPercent`, `formatPercentPoints`, `formatPeriod`), counts that may be a lower bound or unknown (`formatCount`: `1,234`, `≥ 2,000`, `—`; `formatCompactCount`: `1.2k`, `10k+`), `shortId` and `truncate`, so a UI on another framework (the VS Code webview on Preact) shows a date, a duration or a count as the MCP views do; the root entry exports the same names                                                                                                                                                      |
| Tones without React (`./tones`)       | Any runtime, no import: the vocabulary (`ToneVariant`, `TONE_VARIANTS`, `resolveTone`, `isToneVariant`), `SITUATION_TONES` (the one tone per situation on an engine: an open incident, a job without retries, a running or suspended instance, a process that runs without a problem, which is never green) and the count ladder (`countTone`, `severityTone`); the root entry exports the same names                                                                                                                                                                                                                                                                                                                                                                        |
| Komet                                 | `KometMark`/`AppEmptyState` for app-level surfaces only: a landing, a first start, never in a widget                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Fonts and tokens                      | `fontFaces`, `GEIST_FONT_FILES`, `adoptHostFontVariables`, and the tokens as data (`CD_TOKENS`, `ROLE_TOKENS`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Stylesheets                           | `theme.css` (the Miragon theme without Tailwind's entry, over the vendored `--cd-*` tokens of `cd-tokens.generated.css`), `globals.css` (Tailwind, the theme and the kit's sources in one line), `fonts.css` (opt-in Geist, bundled)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Brand gates (`./testing`)             | Node only: `catalogTextFindings` (the voice rules over a message catalog), `scanTypeScale` (the five steps, the 13 px floor, weights 400, 600 and 700 only), `scanGlyphs`, `scanIconSizes` (16 and 24 px; 12 px, `DENSE_ICON_SIZE`, only in the files its `allowDense` names with a reason), `scanColors` and `stylesheetColorFindings` over your sources, `stylesheetShapeFindings` over a stylesheet every view inlines, `contrastFindings` with `toneContrastPairs()` / `ROLE_CONTRAST_PAIRS`                                                                                                                                                                                                                                                                             |
| Product words (`./testing`)           | Node only: `PRODUCT_GLOSSARY` (one word per thing in every Pulse UI, the MCP widgets and the VS Code webview), `glossaryFindings` over a catalog, `sourceTexts` for a source tree that keeps its words in code, `blindGlossaryRules`, `unnamedGlossaryTerms`, `BARE_PAUSE_RULE_EN` (the strict pause rule for a UI that pauses nothing of its own) and `COUNT_TERMS`, the one word per count                                                                                                                                                                                                                                                                                                                                                                                 |

`stylesheetShapeFindings` reports a height floor, a forced or inlined font, a raw colour and a
`--cd-*` token. `contrastFindings` checks WCAG AA in light and dark; `LIGHT_STATUS_EXEMPTION` is
the CI's own exemption for green and amber on light.

The kit is pure React: no MCP SDK, no TanStack Query, no zod and no host. The view runtime that
mounts a view in an MCP host and runs its tool calls is
[`@miragon/pulse-widget-shell`](https://www.npmjs.com/package/@miragon/pulse-widget-shell), which
builds on this kit.

## Your own brand

The theme maps role variables (`--primary`, `--interaction`, `--link`, `--focus`, `--<tone>`,
`--<tone>-soft`, `--<tone>-surface`, `--<tone>-ink`, radii, shadows, fonts) onto the vendored
`--cd-*` tokens, in light and dark. The neutrals carry the Miragon guide's `--cd-ui-*` roles:
`--background` and `--muted` its ground (`#F9F7F7` on light), `--card` its surface, `--popover`
and `--raised` its raised surface, `--accent` its hover, `--border` its line, `--muted-foreground`
its quiet text, `--scrim` its backdrop. The mode follows `.dark`, `data-theme="dark"` and the
guide's own `data-cd-theme="dark"`; `data-cd-kontrast="hoch"` switches high contrast (no shadows,
stronger edges and quiet text, a 3 px focus) and forced colours keep every state visible. Your
brand overrides role variables only, never a `--cd-*` token, under `:root` AND the dark scopes
(`.dark, [data-theme="dark"], [data-theme-mode="dark"], [data-cd-theme="dark"]`), or a light-only
value shows in dark. Measure it in a test with `@miragon/pulse-ui/testing`:
`parseThemeVariables(...themeStylesheets(), brandCss)` and `contrastFindings` over
`toneContrastPairs()` and `ROLE_CONTRAST_PAIRS`.

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
`xs`, 36 px in `lg` (a dialog's footer), its icon sizes square, with the sm radius; its
`toolbar` variant (an icon and a label at 400) hides the label visually, never from the
accessible name, inside a bar narrower than 36rem (the container named `bar`: `ViewBar`,
`Toolbar` and `StatusStrip` set it, any other container leaves the label alone), and turns square
around its icon (a toolbar button without an icon keeps its label). A bar's sides take the gutter,
or `--bar-inset` where a padded surface sets it (widget-shell's `WidgetShell` sets 0, so a bar
inside sits flush with the content). `Input` and `NativeSelect` are
28 px on the ground (`Textarea` too, three lines high at least), `Tabs` with `variant="line"` is
a view's 36 px tab bar (a 2 px `--interaction` bar under the active tab; `TabCount` for a count,
`≥ 2,000` for a capped one and `—` for an unknown one, said in words in the tab's name, both in
the kit's locale; an `aside` at the bar's end, outside the tab list), `SegmentedControl` is a
radio group of 24 px segments with one tab stop whose arrow keys, Home and End move the check,
each segment with an optional count (compact on screen, exact for a screen reader, both in the
kit's locale), tone icon and note (for a host that passes `busy`, `aria-busy` and the picked
segment checked at once until the value follows or the change ends), a menu entry (`MENU_ITEM`)
is 36 px, and `Icon`'s `dense` is the 12 px icon of the named deviation. `Dialog` is at most 560 px wide in
three parts that carry its spacing: `DialogHeader` (16 px above, 24 px left, 8 px below, the
close button's corner kept clear), `DialogBody` (24 px on the sides and below) and
`DialogFooter` (a rule above, 24 px on the sides, 16 px above and below, its buttons `lg`).

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
