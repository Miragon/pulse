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

| Part                                  | What you get                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitives                            | The shadcn-based `Button`, `Card`, `Table`, `Tabs`, `Dialog`, `Alert`, `Input`, `Switch`, …                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Components                            | `WidgetHeader`, `KpiGrid`, `StatusBadge`/`LivePill`/`CountPill`, `FilterBar`, `GroupCard`, `PagedListFooter`, `EmptyState`/`ErrorState`, `DrillButton`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| List and form pieces                  | `Th`/`Td`, `TableEmptyState`, `NamedId`, `Icon`, `Section`, `RowCard`, `NativeSelect`, `SegmentedControl`, `LogText`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Tone, type and focus                  | The tone model (`TONE_*`, `resolveTone`, `ToneVariant`, and the names of `./tones` below), the type scale (`TYPE_SCALE`, `MICRO_LABEL`), the focus ring (`FOCUS_RING`) and `cn`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Locale, toasts, formatters            | `LocaleProvider`, `useLocale`, `createUseT` and the kit's own catalogs in English and German; `ToastProvider`, `useToast`; the formatters of `./format` below, in the locale `setFormatLocale` sets                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Formatters without React (`./format`) | Any runtime, no import: dates and times (`formatTimestamp`, `formatDate`, `formatTime`, `formatClock`, `formatInstant`, `formatRelativeTime`), the one duration form (`formatDuration`: `420ms`, `3m 7s`, `2d 3h`), numbers (`formatNumber`, `formatPercent`, `formatPercentPoints`, `formatPeriod`), counts that may be a lower bound or unknown (`formatCount`: `1,234`, `≥ 2,000`, `—`; `formatCompactCount`: `1.2k`, `10k+`), `shortId` and `truncate`, so a UI on another framework (the VS Code webview on Preact) shows a date, a duration or a count as the MCP views do; the root entry exports the same names |
| Tones without React (`./tones`)       | Any runtime, no import: the vocabulary (`ToneVariant`, `TONE_VARIANTS`, `resolveTone`, `isToneVariant`), `SITUATION_TONES` (the one tone per situation on an engine: an open incident, a job without retries, a running or suspended instance, a process that runs without a problem, which is never green) and the count ladder (`countTone`, `severityTone`); the root entry exports the same names                                                                                                                                                                                                                   |
| Komet                                 | `KometMark`/`AppEmptyState` for app-level surfaces only: a landing, a first start, never in a widget                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Fonts and tokens                      | `fontFaces`, `GEIST_FONT_FILES`, `adoptHostFontVariables`, and the tokens as data (`CD_TOKENS`, `ROLE_TOKENS`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Stylesheets                           | `theme.css` (the Miragon theme without Tailwind's entry, over the vendored `--cd-*` tokens of `cd-tokens.generated.css`), `globals.css` (Tailwind, the theme and the kit's sources in one line), `fonts.css` (opt-in Geist, bundled)                                                                                                                                                                                                                                                                                                                                                                                    |
| Brand gates (`./testing`)             | Node only: `catalogTextFindings` (the voice rules over a message catalog), `scanTypeScale`, `scanGlyphs`, `scanIconSizes` (16 and 24 px; 12 px, `DENSE_ICON_SIZE`, only in the files its `allowDense` names with a reason), `scanColors` and `stylesheetColorFindings` over your sources, `stylesheetShapeFindings` over a stylesheet every view inlines, `contrastFindings` with `toneContrastPairs()` / `ROLE_CONTRAST_PAIRS`                                                                                                                                                                                         |
| Product words (`./testing`)           | Node only: `PRODUCT_GLOSSARY` (one word per thing in every Pulse UI, the MCP widgets and the VS Code webview), `glossaryFindings` over a catalog, `sourceTexts` for a source tree that keeps its words in code, `blindGlossaryRules`, `unnamedGlossaryTerms`, `BARE_PAUSE_RULE_EN` (the strict pause rule for a UI that pauses nothing of its own) and `COUNT_TERMS`, the one word per count                                                                                                                                                                                                                            |

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
value shows in dark.
Measure it in a test with `@miragon/pulse-ui/testing`: `parseThemeVariables(...themeStylesheets(), brandCss)` and
`contrastFindings` over `toneContrastPairs()` and `ROLE_CONTRAST_PAIRS`.

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
