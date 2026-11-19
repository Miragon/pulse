import type { ReactNode } from "react"
import { Badge } from "../primitives/badge.js"
import { cn } from "../lib/utils.js"
import { FOCUS_RING } from "../lib/focus-ring.js"
import { MICRO_LABEL } from "../lib/typography.js"
import { ChevronRight } from "lucide-react"
import { Icon } from "./icon.js"

/** Heading element of a {@link Section} title. */
export type SectionHeadingLevel = "h2" | "h3" | "h4" | "h5" | "h6"

/**
 * A collapsible section: its summary is a 16 px chevron and the title as a heading on the compact
 * chrome step (13 px at 600, `MICRO_LABEL`), in the foreground like a `SectionHeading` (the
 * webview's section titles), the quiet chevron in the foreground too while hovered, so it never
 * outweighs the 13 px view bar above it. The heading element is the one you pass (`as`, default
 * `h3`), so the section sits in the view's outline where it belongs.
 */
export function Section({
  title,
  as: Heading = "h3",
  count,
  badgeVariant = "secondary",
  defaultOpen = false,
  onToggle,
  children,
}: {
  title: ReactNode
  /** Heading element of the title. Default `"h3"`. */
  as?: SectionHeadingLevel
  count?: number
  badgeVariant?: "secondary" | "destructive"
  defaultOpen?: boolean
  /** Lets callers lazy-mount content. */
  onToggle?: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <details open={defaultOpen || undefined} onToggle={(e) => onToggle?.(e.currentTarget.open)}>
      <summary
        className={cn(
          "group/section text-foreground flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm [&::-webkit-details-marker]:hidden",
          FOCUS_RING,
        )}
      >
        <Icon
          icon={ChevronRight}
          className="text-muted-foreground group-hover/section:text-foreground transition-transform motion-reduce:transition-none [[open]>summary>&]:rotate-90"
        />
        <Heading className={MICRO_LABEL}>{title}</Heading>
        {count !== undefined && <Badge variant={badgeVariant}>{count}</Badge>}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  )
}
