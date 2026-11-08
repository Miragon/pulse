# @miragon/pulse-ui

[![npm](https://img.shields.io/npm/v/@miragon/pulse-ui?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-ui)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

Pulse's design kit: the React components, the tone model and the Miragon theme that every Pulse
view is built from, ready for your own MCP App views and your own React UIs.

## Install

```sh
npm install @miragon/pulse-ui react react-dom lucide-react tailwindcss
```

`react`, `react-dom` and `lucide-react` are required peers. `tailwindcss` is needed for the
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

## What it provides

- **The root entry** (`@miragon/pulse-ui`): the shadcn-based primitives (`Button`, `Card`,
  `Table`, `Tabs`, `Dialog`, `Alert`, `Input`, `Switch`, …) and the components on top
  (`WidgetHeader`, `KpiGrid`, `StatusBadge`/`LivePill`/`CountPill`, `FilterBar`, `GroupCard`,
  `PagedListFooter`, `EmptyState`/`ErrorState`, `DrillButton`); the tone model (`TONE_*`,
  `resolveTone`, `ToneVariant`), the type scale (`TYPE_SCALE`, `MICRO_LABEL`), the focus ring
  (`FOCUS_RING`) and `cn`; the locale (`LocaleProvider`, `useLocale`, `createUseT`, the kit's own
  catalogs in English and German) and the toasts (`ToastProvider`, `useToast`); the formatters
  (`formatNumber`, `formatDuration`, `formatTimestamp`, … in the locale `setFormatLocale` sets,
  see the minimal example); the pieces every list and form shares (`Th`/`Td`, `TableEmptyState`,
  `NamedId`, `Icon`, `Section`, `RowCard`, `NativeSelect`, `SegmentedControl`, `LogText`); the Komet for app-level surfaces only
  (`KometMark`/`AppEmptyState`: a landing, a first start, never in a widget); the font helpers
  (`fontFaces`, `GEIST_FONT_FILES`, `adoptHostFontVariables`) and the tokens as data
  (`CD_TOKENS`, `ROLE_TOKENS`).
- **The brand gates** (`@miragon/pulse-ui/testing`, Node only): `catalogTextFindings` (the voice
  rules over a message catalog), `scanTypeScale`, `scanGlyphs`, `scanIconSizes`, `scanColors` and
  `stylesheetColorFindings` over your sources, `stylesheetShapeFindings` over a stylesheet every
  view inlines (no height floor, no forced or inlined font, no raw colour, no `--cd-*` token), and
  `contrastFindings` with `toneContrastPairs()` / `ROLE_CONTRAST_PAIRS` for WCAG AA in light and
  dark (`LIGHT_STATUS_EXEMPTION` is the CI's own exemption for green and amber on light).
- **The stylesheets**: `theme.css` (the Miragon theme without Tailwind's entry; it imports the
  vendored `--cd-*` corporate-design tokens, `cd-tokens.generated.css`), `globals.css` (Tailwind,
  the theme and the kit's sources in one line) and `fonts.css` (opt-in Geist, bundled).

## Use with Tailwind v4

Your stylesheet imports Tailwind, scans the kit's compiled sources and imports the theme after it:

```css
@import "tailwindcss";
@source "../node_modules/@miragon/pulse-ui/dist";
@import "@miragon/pulse-ui/theme.css";
```

Never import `globals.css` next to your own Tailwind entry (two Tailwind layers), and never
`fonts.css` in an MCP App view: an inlining bundler embeds the font files in every view. Serve the
fonts by URL with `fontFaces({ baseUrl })` instead.

## Theme

The theme maps role variables (`--primary`, `--link`, `--focus`, `--<tone>`, `--<tone>-soft`,
`--<tone>-ink`, radii, shadows, fonts) onto the vendored `--cd-*` tokens, in light and dark. A
brand overrides role variables only, never a `--cd-*` token, under `:root` AND the dark scopes
(`.dark, [data-theme="dark"], [data-theme-mode="dark"]`), or a light-only value shows in dark.
Measure a brand in a test: `parseThemeVariables(...themeStylesheets(), brandCss)` and
`contrastFindings` over `toneContrastPairs()` and `ROLE_CONTRAST_PAIRS`.

## What it is not

Pure React: no MCP SDK, no TanStack Query, no zod and no host. The view runtime (a view
mounted in an MCP host and its tool calls) is
[`@miragon/pulse-widget-shell`](../widget-shell) (`/widgets`), which builds on this kit.

## License

MIT
