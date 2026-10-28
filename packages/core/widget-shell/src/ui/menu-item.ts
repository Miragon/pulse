import { cn, FOCUS_RING_INSET } from "@miragon/mcp-toolkit-ui"

/**
 * CI §8 menu entry. The focus ring is drawn inside so a neighbour never covers
 * it. Use with `role="menuitem"` and `tabIndex={-1}`: arrow keys move focus.
 */
export const MENU_ITEM = cn(
  "text-foreground text-dense flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-start font-medium whitespace-nowrap transition-colors",
  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
  "disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  FOCUS_RING_INSET,
)
