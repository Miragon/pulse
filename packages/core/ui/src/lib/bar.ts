/**
 * What the kit's bars share (`ViewBar`, `Toolbar`, `StatusStrip`): each names its container
 * `bar`, so a toolbar button's label collapses by the width of the bar it sits in (the Button's
 * toolbar variant queries `@container bar`), and a block inside reflows by that bar's width.
 */
export const BAR_CONTAINER = "@container/bar"

/**
 * A bar's side padding, the gutter: a bar runs from edge to edge of its surface (widget-shell's
 * `WidgetShell` pads only its content), and its first and last control line up with the content
 * below it. A bar placed inside padded content (a list's `Toolbar` under a section's heading)
 * reaches the surface's edges with `-mx-gutter`, as a view's tab bar does.
 */
export const BAR_INSET = "px-gutter"
