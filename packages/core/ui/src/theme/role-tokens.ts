type CssVarName = `--${string}`

/**
 * The density roles (`src/theme.css`): compact by default, in rem on the Miragon guide's
 * shell ladder (`--cd-shell-zeile` 40 px, `-eintrag` 36, `-ziel` 32, `-rand` 12 at a 16 px
 * root), the comfortable step under `any-pointer: coarse` and `[data-density="comfortable"]`.
 * Mode-independent, and no colour: the one set of roles that switches under a media query.
 */
export const DENSITY_ROLES = [
  "--bar-h",
  "--toolbar-h",
  "--entry-h",
  "--control-h",
  "--control-h-xs",
  "--control-h-lg",
  "--row-h",
  "--cell-px",
  "--cell-py",
  "--gutter",
  "--section-gap",
  "--segment-h",
  "--button-radius",
  "--badge-h",
] as const satisfies readonly CssVarName[]

/**
 * The role-token contract: every variable the kit defines for components
 * to use (`src/theme.css`), in light and, for colours, dark. Components in this
 * package, and in apps built on it, style through these names only, never
 * through raw colours or Tailwind palette classes. The neutrals carry the
 * values of the Miragon guide's `--cd-ui-*` roles (`--background` grund,
 * `--card` flaeche, `--popover` and `--raised` flaeche-hoch, `--accent` hover,
 * `--border` linie, `--interaction` interaktion, `--<tone>-surface` the status
 * surface). The density roles close the list.
 */
export const ROLE_TOKENS = [
  "--background",
  "--card",
  "--popover",
  "--raised",
  "--muted",
  "--accent",
  "--secondary",
  "--foreground",
  "--muted-foreground",
  "--border",
  "--input",
  "--primary",
  "--primary-foreground",
  "--primary-hover",
  "--interaction",
  "--link",
  "--ring",
  "--focus",
  "--focus-width",
  "--success",
  "--warning",
  "--danger",
  "--info",
  "--success-soft",
  "--warning-soft",
  "--danger-soft",
  "--info-soft",
  "--success-surface",
  "--warning-surface",
  "--danger-surface",
  "--info-surface",
  "--success-ink",
  "--warning-ink",
  "--danger-ink",
  "--info-ink",
  "--destructive",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--radius-pill",
  "--shadow-1",
  "--shadow-2",
  "--shadow-3",
  "--scrim",
  "--motion-fast",
  "--motion-base",
  "--motion-slow",
  "--ease",
  "--font-sans",
  "--font-mono",
  "--text-title",
  "--text-section",
  "--text-body",
  "--text-dense",
  "--text-small",
  ...DENSITY_ROLES,
] as const satisfies readonly CssVarName[]
