import { cn } from "../lib/utils.js"
import { FOCUS_RING_INSET } from "../lib/focus-ring.js"

/**
 * CI §8 menu entry, 13 px at 400. The focus ring is drawn inside so a neighbour never covers
 * it. Use with `role="menuitem"` and `tabIndex={-1}`: arrow keys move focus. Disabled is
 * opaque, never faded (CI §8): quiet text, no hover fill, the not-allowed cursor.
 */
export const MENU_ITEM = cn(
  "text-foreground text-dense flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-start font-normal whitespace-nowrap transition-colors",
  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
  "disabled:text-muted-foreground disabled:cursor-not-allowed disabled:bg-transparent [&_svg]:shrink-0",
  FOCUS_RING_INSET,
)
