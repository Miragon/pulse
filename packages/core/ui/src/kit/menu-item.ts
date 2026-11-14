import { cn } from "../lib/utils.js"
import { FOCUS_RING_INSET } from "../lib/focus-ring.js"

/**
 * CI §8 menu entry, 13 px at 400, the density's entry height (36 px, 40 px on touch; the guide's
 * eintrag). The focus ring is drawn inside so a neighbour never covers it. Use with `role="menuitem"` and `tabIndex={-1}`: arrow keys move focus. Disabled is
 * opaque, never faded (CI §8): quiet text, no hover fill, the not-allowed cursor.
 */
export const MENU_ITEM = cn(
  "text-foreground text-dense min-h-entry flex w-full items-center gap-2 rounded-sm px-3 text-start font-normal whitespace-nowrap transition-colors",
  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
  "disabled:text-muted-foreground disabled:cursor-not-allowed disabled:bg-transparent [&_svg]:shrink-0",
  FOCUS_RING_INSET,
)
