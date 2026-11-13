/**
 * What the kit's bars share (`ViewBar`, `Toolbar`, `StatusStrip`): each names its container
 * `bar`, so a toolbar button's label collapses by the width of the bar it sits in (the Button's
 * toolbar variant queries `@container bar`), and a block inside reflows by that bar's width.
 */
export const BAR_CONTAINER = "@container/bar"

/**
 * A bar's side padding: the gutter, or `--bar-inset` where a padded surface sets it (widget-shell's
 * `WidgetShell` sets 0, so a bar inside sits flush with the content around it).
 */
export const BAR_INSET = "px-[var(--bar-inset,var(--gutter))]"
