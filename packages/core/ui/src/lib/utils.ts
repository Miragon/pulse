import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"
import { DENSITY_RADIUS, DENSITY_SPACING } from "./density.js"
import { FIELD_TEXT, TYPE_STEPS } from "./typography.js"

/**
 * tailwind-merge that knows the kit's type scale, the field's text and the density keys. Out
 * of the box it reads an unknown `text-small` as a text COLOUR and drops it next to
 * `text-muted-foreground`; registered as font sizes, `text-small` conflicts
 * only with other sizes (`text-sm`, `text-xs`), as it should. An unknown
 * density key would conflict with nothing and leave both heights in the class
 * list; registered as spacing and radius keys, the later one wins, a density
 * key or Tailwind's own.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...TYPE_STEPS, FIELD_TEXT.slice("text-".length)],
      spacing: Object.keys(DENSITY_SPACING),
      radius: Object.keys(DENSITY_RADIUS),
    },
    // The cell's padding, an `@utility` per axis (DENSITY_CELL_PADDING).
    classGroups: { px: [{ px: ["cell"] }], py: [{ py: ["cell"] }] },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
