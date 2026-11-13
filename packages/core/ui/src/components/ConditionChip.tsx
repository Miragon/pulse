import type { MouseEvent, RefObject } from "react"
import { X } from "lucide-react"
import { Icon } from "../kit/icon.js"
import { FOCUS_RING } from "../lib/focus-ring.js"
import { cn } from "../lib/utils.js"
import { useUiMessages } from "../locale/locale-provider.js"
import { Button } from "../primitives/button.js"

export interface ConditionChipProps {
  /** The condition in words ("amount > 100"): the chip's text, cut where it has no room. */
  label: string
  /** A quiet word before it ("At"), part of the chip's text and of its buttons' names. */
  prefix?: string
  /**
   * Opens the condition's editor (a dialog), handed the chip's edit button: the kit's `Dialog`
   * gives the focus back to it when it closes. Without it the chip's text is no button.
   */
  onEdit?: (opener: HTMLButtonElement) => void
  /** Removes the condition: the chip leaves. */
  onRemove: () => void
  /**
   * The control that opens the conditions (a filter button): it takes the focus once the chip is
   * removed, since the chip's own button leaves with it.
   */
  opener?: RefObject<HTMLElement | null>
  className?: string
}

/**
 * A condition a list is filtered by, as a 28 px pill on the raised surface (the webview's
 * variable chip): its text, an edit button when `onEdit` is set (the text itself) and a 24 px
 * remove button, each named with the chip's text. Up to 240 px wide, the text cut with an
 * ellipsis and whole in its title. Removing hands the focus to `opener`. A filter you toggle on
 * and off is a `FilterBar` chip instead.
 */
export function ConditionChip({
  label,
  prefix,
  onEdit,
  onRemove,
  opener,
  className,
}: ConditionChipProps) {
  const { conditionChip } = useUiMessages()
  const text = prefix ? `${prefix} ${label}` : label
  const words = (
    <>
      {prefix && <span className="text-muted-foreground">{prefix} </span>}
      {label}
    </>
  )
  const remove = () => {
    onRemove()
    opener?.current?.focus()
  }
  return (
    <span
      data-slot="condition-chip"
      title={text}
      className={cn(
        "border-border bg-raised text-dense min-h-control rounded-pill inline-flex max-w-60 min-w-0 shrink-0 items-center gap-1 border pr-0.5 pl-2.5",
        className,
      )}
    >
      {onEdit ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={conditionChip.edit({ label: text })}
          onClick={(event: MouseEvent<HTMLButtonElement>) => onEdit(event.currentTarget)}
          className={cn("hover:text-link min-w-0 truncate rounded-sm text-left", FOCUS_RING)}
        >
          {words}
        </button>
      ) : (
        <span className="min-w-0 truncate">{words}</span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={conditionChip.remove({ label: text })}
        onClick={remove}
        className="rounded-pill text-muted-foreground hover:text-foreground focus-visible:ring-offset-0"
      >
        <Icon icon={X} />
      </Button>
    </span>
  )
}
