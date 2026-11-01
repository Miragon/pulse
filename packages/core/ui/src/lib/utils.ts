import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"
import { TYPE_STEPS } from "./typography.js"

/**
 * tailwind-merge that knows the kit's type scale. Out of the box it reads
 * an unknown `text-small` as a text COLOUR and drops it next to
 * `text-muted-foreground`; registered as font sizes, `text-small` conflicts
 * only with other sizes (`text-sm`, `text-xs`), as it should.
 */
const twMerge = extendTailwindMerge({
  extend: { theme: { text: [...TYPE_STEPS] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
