import type { LucideIcon } from "lucide-react"
import { cn } from "../lib/utils.js"

export type { LucideIcon }

/** The CI stroke (modeler-tool-design §11); pass it to a `LucideProvider` if you use one. */
export const ICON_STROKE = 2.5
export const DENSE_ICON_STROKE = 2

/**
 * Stroke set on the icon itself so it holds outside a `LucideProvider` too.
 * Decorative by default; `label` only for a standalone icon that carries meaning.
 */
export function Icon({
  icon: Glyph,
  size = 16,
  dense = false,
  label,
  className,
}: {
  icon: LucideIcon
  size?: number
  dense?: boolean
  label?: string
  className?: string
}) {
  return (
    <Glyph
      size={size}
      strokeWidth={dense ? DENSE_ICON_STROKE : ICON_STROKE}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      focusable="false"
      className={cn("shrink-0", className)}
    />
  )
}
