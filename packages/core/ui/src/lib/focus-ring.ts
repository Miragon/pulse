/**
 * The kit's focus indicator as Tailwind classes: an opaque ring in the
 * `--focus` role (blau-link on light, blau-hell on dark; 3:1 or more against
 * every surface, see `theme/theme-contrast.test.ts`), `--focus-width` wide (2px,
 * 3px under `data-cd-kontrast="hoch"`), offset from the control so it reads on
 * any fill. Every interactive kit control uses it; spread it into a
 * custom control's `className` so keyboard focus looks the same everywhere.
 * (`theme.css` also gives every element without its own ring an opaque
 * `:focus-visible` outline in the same colour.)
 *
 * The ring is a box-shadow, which forced-colors mode (Windows High Contrast)
 * drops. `focus-visible:outline-hidden` hides the outline outside that mode and
 * keeps a transparent 2px outline in it, which the browser paints in the system
 * colour, so focus stays visible there too. Only while focus is visible: an
 * unconditional `outline-hidden` would draw that outline at rest, a frame on
 * every control that focus then adds nothing to.
 */
export const FOCUS_RING =
  "focus-visible:outline-hidden focus-visible:ring-(length:--focus-width) focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background"

/**
 * {@link FOCUS_RING} drawn inside the element, for cells and rows flush with a container edge;
 * under forced colours its outline sits inside too, so a scrolling or clipping container never
 * cuts it.
 */
export const FOCUS_RING_INSET =
  "focus-visible:outline-hidden focus-visible:ring-(length:--focus-width) focus-visible:ring-focus focus-visible:ring-inset forced-colors:focus-visible:-outline-offset-2"

/**
 * A text field's own focus (`Input`, `Textarea`): its border turns `--focus` and a ring adds the
 * rest of `--focus-width`, a 2px opaque edge (CI §8), 3px under `data-cd-kontrast="hoch"`.
 * Internal: `SearchField` draws the same edge on its box while its input has focus.
 */
export const FIELD_FOCUS =
  "focus-visible:border-focus focus-visible:ring-focus focus-visible:ring-[length:calc(var(--focus-width)-1px)]"
