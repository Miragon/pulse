import { useId, type MouseEvent, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { FOCUS_RING } from "../lib/focus-ring.js"
import { cn } from "../lib/utils.js"
import { Icon } from "../kit/icon.js"
import type { SectionHeadingLevel } from "../kit/section.js"

export interface GroupCardProps {
  /** Whether the body is expanded. */
  expanded: boolean
  /** Toggles the body: the toggle's click, Enter and Space, and a click on the summary around it. */
  onToggle: () => void
  /**
   * The group's name: the toggle's content after its chevron, so its accessible name too. Text and
   * quiet parts only (a key in mono), never a control. Its root element is a flex item beside the
   * chevron: give it `block truncate` for one line, `break-words` to wrap.
   */
  title: ReactNode
  /**
   * The summary bar around the toggle: it gets the toggle (a `<button aria-expanded>` holding the
   * chevron and {@link GroupCardProps.title}) to place, and lays out the rest beside it (a count,
   * facts, a drill, a menu), each a sibling of the toggle, never inside it. Omit for a bar of the
   * toggle alone.
   */
  summary?: (toggle: ReactNode) => ReactNode
  /**
   * The heading the toggle sits in (`h3` under a section's `h2`), so each group is a stop of the
   * view's outline, as an accordion's headers are. Default: none.
   */
  as?: SectionHeadingLevel
  /** Collapsible body, rendered only when `expanded`. */
  children?: ReactNode
}

/**
 * The toggle's chevron and its gap (16 px and 6 px): a summary's further line (facts, a cause)
 * takes it as its start padding, so it lines up with the title after the chevron.
 */
export const GROUP_CARD_INSET = "ps-5.5"

/** A click that lands on a control of the summary is that control's, never the toggle's. */
const CONTROL = "button, a, input, select, textarea, label, summary, [role='menuitem']"

/**
 * Bordered card with a summary bar and a collapsible body, to group related rows behind an
 * expandable header (items grouped by a key). The toggle is a real `<button aria-expanded>` around
 * the chevron and the group's title, the chevron before the title turning down while expanded, as
 * the kit's collapsible `Section` does: a chevron means expand, never navigate (a drill is an
 * arrow). The summary's other controls (a drill, a menu) are siblings of the toggle, so nothing is
 * nested in an interactive element and Enter or Space on them does what they say, never toggles.
 * A pointer may click anywhere on the summary outside its controls to toggle too: a convenience
 * of the mouse, the keyboard's way is the toggle.
 */
export function GroupCard({ expanded, onToggle, title, summary, as, children }: GroupCardProps) {
  const bodyId = useId()
  const Heading = as
  const button = (
    <button
      type="button"
      data-slot="group-card-toggle"
      aria-expanded={expanded}
      aria-controls={expanded && children ? bodyId : undefined}
      onClick={onToggle}
      className={cn(
        "text-foreground flex max-w-full min-w-0 cursor-pointer items-start gap-1.5 rounded-sm text-left",
        FOCUS_RING,
      )}
    >
      {/* On the title's first line: 16 px in its 19.5 px line box. */}
      <Icon
        icon={ChevronRight}
        className={cn(
          "text-muted-foreground mt-0.5 transition-transform motion-reduce:transition-none",
          expanded && "rotate-90",
        )}
      />
      {title}
    </button>
  )
  const toggle = Heading ? (
    <Heading data-slot="group-card-heading" className="flex min-w-0">
      {button}
    </Heading>
  ) : (
    button
  )

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(CONTROL)) return
    onToggle()
  }

  return (
    <div data-slot="group-card" className="border-border mb-2 overflow-hidden rounded-md border">
      {/* A pointer's convenience, no role and no tab stop: the toggle inside is the control. */}
      <div
        data-slot="group-card-summary"
        onClick={handleClick}
        className={cn(
          "bg-card hover:bg-accent cursor-pointer transition-colors",
          expanded && "border-border border-b",
        )}
      >
        {summary ? summary(toggle) : <div className="px-cell py-cell">{toggle}</div>}
      </div>
      {expanded && children && <div id={bodyId}>{children}</div>}
    </div>
  )
}
