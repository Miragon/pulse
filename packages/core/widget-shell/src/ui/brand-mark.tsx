import type { ReactNode } from "react"
import { cn, EmptyState, type StateHeadingLevel } from "@miragon/mcp-toolkit-ui"
import { KOMET_SVG } from "./komet-svg.js"

/** The Komet never renders smaller than this (CI: legible as the Miragon icon). */
export const KOMET_MIN_SIZE = 24

/** App-level surfaces only (owner decision): the official Komet, inlined unchanged. A customer brand hides it with `--brand-mark-display: none`; decorative unless `label` is passed. */
export function KometMark({
  size = 48,
  label,
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  const px = Math.max(KOMET_MIN_SIZE, size)
  return (
    <span
      data-brand-mark="komet"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("shrink-0 items-center justify-center [&>svg]:size-full!", className)}
      style={{ display: "var(--brand-mark-display, inline-flex)", width: px, height: px }}
      // The CI's file, byte for byte — no JSX re-drawing of the mark.
      dangerouslySetInnerHTML={{ __html: KOMET_SVG }}
    />
  )
}

/** Widgets use `TableEmptyState`: the Komet belongs to the app, not to every list. */
export function AppEmptyState({
  title,
  description,
  action,
  secondaryAction,
  titleAs = "h2",
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  secondaryAction?: ReactNode
  titleAs?: StateHeadingLevel
  className?: string
}) {
  return (
    <EmptyState
      icon={<KometMark />}
      title={title}
      description={description}
      action={action}
      secondaryAction={secondaryAction}
      titleAs={titleAs}
      className={cn("py-12", className)}
    />
  )
}
