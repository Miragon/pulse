import type { DENSITY_ROLES } from "../theme/role-tokens.js"

type DensityRole = (typeof DENSITY_ROLES)[number]

/**
 * The utilities over the density roles (`src/theme.css`), each role under one key.
 *
 * | Key          | Role              | Compact | Comfortable | Use                                      |
 * | ------------ | ----------------- | ------- | ----------- | ---------------------------------------- |
 * | `bar`        | `--bar-h`         | 40 px   | 48 px       | the view's bar, a frame's toolbar        |
 * | `toolbar`    | `--toolbar-h`     | 36 px   | 40 px       | a tab bar, a filter bar, an action row   |
 * | `entry`      | `--entry-h`       | 36 px   | 40 px       | a menu entry, an interactive list entry  |
 * | `control`    | `--control-h`     | 28 px   | 36 px       | a button, an input, a select, a chip     |
 * | `control-xs` | `--control-h-xs`  | 24 px   | 32 px       | a strip's button, a copy button          |
 * | `control-lg` | `--control-h-lg`  | 36 px   | 40 px       | a dialog's footer, a page's action       |
 * | `row`        | `--row-h`         | 28 px   | 40 px       | a table row (a cell's minimum height)    |
 * | `gutter`     | `--gutter`        | 12 px   | 16 px       | the inset of a view, a bar, a strip      |
 * | `section`    | `--section-gap`   | 12 px   | 16 px       | the gap between a view's sections        |
 * | `segment`    | `--segment-h`     | 24 px   | 32 px       | a segment inside a segmented control     |
 * | `badge`      | `--badge-h`       | 20 px   | 20 px       | a count badge, never a target            |
 *
 * Every spacing utility takes a key (height, minimum height, size, padding, gap: `min-h-` plus
 * `control`); controls and bars take theirs as a minimum height, so text at 200 % never clips.
 * The cell's padding has a role per axis (`--cell-px` 12 px, `--cell-py` 4 px, 8 px comfortable),
 * so its two utilities are their own (`px-` and `py-` plus `cell`, an `@utility` each), and the
 * button's radius (`--button-radius`, sm compact, md comfortable) is the radius key `button`.
 * Combine them through the kit's `cn`, which knows every key.
 */
export const DENSITY_SPACING = {
  bar: "--bar-h",
  toolbar: "--toolbar-h",
  entry: "--entry-h",
  control: "--control-h",
  "control-xs": "--control-h-xs",
  "control-lg": "--control-h-lg",
  row: "--row-h",
  gutter: "--gutter",
  section: "--section-gap",
  segment: "--segment-h",
  badge: "--badge-h",
} as const satisfies Readonly<Record<string, DensityRole>>

/** The cell's padding: the axis utility (`px`, `py`) and its role, under the key `cell`. */
export const DENSITY_CELL_PADDING = {
  px: "--cell-px",
  py: "--cell-py",
} as const satisfies Readonly<Record<string, DensityRole>>

/** The radius keys over the density roles. */
export const DENSITY_RADIUS = {
  button: "--button-radius",
} as const satisfies Readonly<Record<string, DensityRole>>
