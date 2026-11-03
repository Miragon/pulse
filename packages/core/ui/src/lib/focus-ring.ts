/**
 * The kit's focus indicator as Tailwind classes: an opaque 2px ring in the
 * `--focus` role (blau-link on light, blau-hell on dark; 3:1 or more against
 * every surface, see `theme/theme-css.test.ts`), offset from the control so it
 * reads on any fill. Every interactive kit control uses it; spread it into a
 * custom control's `className` so keyboard focus looks the same everywhere.
 * (`theme.css` also gives every element without its own ring an opaque
 * `:focus-visible` outline in the same colour.)
 *
 * The ring is a box-shadow, which forced-colors mode (Windows High Contrast)
 * drops. `outline-hidden` (never `outline-none`) hides the outline only
 * outside that mode and keeps a transparent 2px outline in it, which the
 * browser paints in the system colour, so focus stays visible there too.
 */
export const FOCUS_RING =
  "outline-hidden focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background"

/** {@link FOCUS_RING} drawn inside the element, for cells and rows flush with a container edge. */
export const FOCUS_RING_INSET =
  "outline-hidden focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
