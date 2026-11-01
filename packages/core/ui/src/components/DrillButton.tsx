import type { ReactNode } from "react"
import { ArrowRight } from "lucide-react"
import { buttonVariants } from "../primitives/button.js"

export interface DrillButtonProps {
  /** Button label. */
  children: ReactNode
  /** Drill/navigation handler — wire to in-widget navigation (e.g. `showWidget`). */
  onDrill: () => void
  /**
   * Optional leading icon — a Lucide icon of the domain, never a typed glyph.
   * Decorative (`aria-hidden`). The trailing arrow is always rendered.
   */
  icon?: ReactNode
  /** `sm` for table rows, `md` for surface headers. Default `"sm"`. */
  size?: "sm" | "md"
  /** Accessible label when the visible text is terse; keep the visible text in it (WCAG 2.5.3). */
  ariaLabel?: string
}

/** The `Button` size each drill size is: one scale for every action of a view. */
const BUTTON_SIZE = { sm: "sm", md: "default" } as const

/**
 * The single, deterministic in-widget navigation control: a neutral outline
 * button with a trailing Lucide arrow that drills into a detail/sub-view. Use
 * it for every in-app drill (row "Open", header nav) so they read identically
 * and stay visually quieter than primary/agentic actions. Decoupled from any
 * host — pass an `onDrill` callback (e.g. wrapping `useHostActions().showWidget`).
 *
 * It IS the kit's outline `Button` (`buttonVariants`): `sm` is 32 px,
 * 14 px, weight 600, the size of a `Button size="sm"` or an `AskAiButton`
 * beside it in a row; `md` is the `Button` default (36 px). The design
 * system gives every button weight 600 and one radius.
 */
export function DrillButton({ children, onDrill, icon, size = "sm", ariaLabel }: DrillButtonProps) {
  return (
    <button
      type="button"
      onClick={onDrill}
      aria-label={ariaLabel}
      className={buttonVariants({ variant: "outline", size: BUTTON_SIZE[size] })}
    >
      {icon && (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      )}
      {children}
      <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
    </button>
  )
}
