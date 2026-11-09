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
stylesheets only, and `typescript` for the brand gates under `./testing` only.

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

| Part                       | What you get                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Primitives                 | The shadcn-based `Button`, `Card`, `Table`, `Tabs`, `Dialog`, `Alert`, `Input`, `Switch`, …                                                                                                                                                                                                                                    |
| Components                 | `WidgetHeader`, `KpiGrid`, `StatusBadge`/`LivePill`/`CountPill`, `FilterBar`, `GroupCard`, `PagedListFooter`, `EmptyState`/`ErrorState`, `DrillButton`                                                                                                                                                                         |
| List and form pieces       | `Th`/`Td`, `TableEmptyState`, `NamedId`, `Icon`, `Section`, `RowCard`, `NativeSelect`, `SegmentedControl`, `LogText`                                                                                                                                                                                                           |
| Tone, type and focus       | The tone model (`TONE_*`, `resolveTone`, `ToneVariant`), the type scale (`TYPE_SCALE`, `MICRO_LABEL`), the focus ring (`FOCUS_RING`) and `cn`                                                                                                                                                                                  |
| Locale, toasts, formatters | `LocaleProvider`, `useLocale`, `createUseT` and the kit's own catalogs in English and German; `ToastProvider`, `useToast`; `formatNumber`, `formatDuration`, `formatTimestamp`, … in the locale `setFormatLocale` sets                                                                                                         |
| Komet                      | `KometMark`/`AppEmptyState` for app-level surfaces only: a landing, a first start, never in a widget                                                                                                                                                                                                                           |
| Fonts and tokens           | `fontFaces`, `GEIST_FONT_FILES`, `adoptHostFontVariables`, and the tokens as data (`CD_TOKENS`, `ROLE_TOKENS`)                                                                                                                                                                                                                 |
| Stylesheets                | `theme.css` (the Miragon theme without Tailwind's entry, over the vendored `--cd-*` tokens of `cd-tokens.generated.css`), `globals.css` (Tailwind, the theme and the kit's sources in one line), `fonts.css` (opt-in Geist, bundled)                                                                                           |
| Brand gates (`./testing`)  | Node only: `catalogTextFindings` (the voice rules over a message catalog), `scanTypeScale`, `scanGlyphs`, `scanIconSizes`, `scanColors` and `stylesheetColorFindings` over your sources, `stylesheetShapeFindings` over a stylesheet every view inlines, `contrastFindings` with `toneContrastPairs()` / `ROLE_CONTRAST_PAIRS` |

`stylesheetShapeFindings` reports a height floor, a forced or inlined font, a raw colour and a
`--cd-*` token. `contrastFindings` checks WCAG AA in light and dark; `LIGHT_STATUS_EXEMPTION` is
the CI's own exemption for green and amber on light.

The kit is pure React: no MCP SDK, no TanStack Query, no zod and no host. The view runtime that
mounts a view in an MCP host and runs its tool calls is
[`@miragon/pulse-widget-shell`](https://www.npmjs.com/package/@miragon/pulse-widget-shell), which
builds on this kit.

## Your own brand

The theme maps role variables (`--primary`, `--link`, `--focus`, `--<tone>`, `--<tone>-soft`,
`--<tone>-ink`, radii, shadows, fonts) onto the vendored `--cd-*` tokens, in light and dark. Your
brand overrides role variables only, never a `--cd-*` token, under `:root` AND the dark scopes
(`.dark, [data-theme="dark"], [data-theme-mode="dark"]`), or a light-only value shows in dark.
Measure it in a test with `@miragon/pulse-ui/testing`: `parseThemeVariables(...themeStylesheets(), brandCss)` and
`contrastFindings` over `toneContrastPairs()` and `ROLE_CONTRAST_PAIRS`.

## Help and feedback

- **Documentation:** building your own server and views is explained at [miragon.github.io/pulse](https://miragon.github.io/pulse/).
- **Bugs and ideas:** found a bug or missing something? [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How to build, test and change Pulse is in [CONTRIBUTING.md](https://github.com/Miragon/pulse/blob/main/CONTRIBUTING.md).

## License

[MIT](LICENSE) © Miragon GmbH
