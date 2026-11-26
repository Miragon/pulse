import { useEffect, useRef, type Ref } from "react"
import { Button } from "@miragon/pulse-ui"
import { useProcessWords } from "../../messages/process-words.js"

export interface LoadMoreProps {
  /** While the surface reads again: the button waits, and says why. */
  readonly busy: boolean
  /** Asks for the next page, which the surface puts after the rows shown. */
  readonly onMore: () => void
  /** The button, for the table that moves the focus on after its page (`InstanceTable`). */
  readonly ref?: Ref<HTMLButtonElement>
}

/** What a Load more under a table asked at: the rows shown then, its button and their body. */
interface Asked {
  readonly before: number
  readonly button: HTMLElement
  readonly body: HTMLElement | undefined
}

/** How far up from Load more the table's body is looked for: the surface's footer and its table. */
const BODY_DEPTH = 6

/** The last table body before `button` in its table's part of the page, never a hidden one. */
function bodyBefore(button: HTMLElement): HTMLElement | undefined {
  let scope = button.parentElement
  for (let depth = 0; scope !== null && depth < BODY_DEPTH; depth += 1) {
    const bodies = Array.from(scope.querySelectorAll<HTMLElement>("tbody")).filter(
      (body) =>
        body.getAttribute("aria-hidden") !== "true" &&
        (body.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    )
    const body = bodies.at(-1)
    if (body !== undefined) return body
    scope = scope.parentElement
  }
  return undefined
}

/**
 * Whether the reader is still where Load more left them: at its button, which keeps the focus while
 * the page loads, or nowhere (the page's body), where the last page took the button away.
 */
function stillAt(button: HTMLElement): boolean {
  const active = document.activeElement
  return active === document.body || active === button
}

/**
 * Where the focus goes after a page Load more asked for (the kit's rule for a paged list): to the
 * first new row, which the surface's table lets take the focus, else it stays on the button, which
 * never turns `disabled` while the page loads (that would drop the focus to the page's body). Never
 * where the reader went meanwhile, and not at all when the rows started over (a Refresh, another
 * filter). `shown`: the rows on screen. `button` goes to the Load more, `ask` records a page asked
 * for there, `again` puts the focus back on it first (a failed page's Try again, which goes with
 * its failure).
 */
export function useFocusAfterMore(shown: number) {
  const button = useRef<HTMLButtonElement>(null)
  const asked = useRef<Asked | null>(null)
  useEffect(() => {
    const was = asked.current
    if (was === null || shown === was.before) return undefined
    asked.current = null
    if (shown < was.before || !stillAt(was.button)) return undefined
    // After the rows' own effects: a table marks a new row focusable once it is in the DOM.
    const timer = setTimeout(() => {
      const row = was.body?.querySelectorAll<HTMLElement>(":scope > tr")[was.before]
      if (row?.isConnected === true && stillAt(was.button)) row.focus()
    }, 0)
    return () => {
      clearTimeout(timer)
    }
  }, [shown])
  const ask = () => {
    const at = button.current
    asked.current = at === null ? null : { before: shown, button: at, body: bodyBefore(at) }
  }
  const again = () => {
    button.current?.focus()
    ask()
  }
  return { button, ask, again }
}

/**
 * The button under a list that pages by cursor: it asks for the next page. While the surface reads
 * it waits (`aria-disabled`, so it keeps the focus and its place in the tab order) and says why.
 */
export function LoadMore({ busy, onMore, ref }: LoadMoreProps) {
  const t = useProcessWords()
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="sm"
      data-part="load-more"
      aria-disabled={busy || undefined}
      className="aria-disabled:text-muted-foreground aria-disabled:cursor-not-allowed aria-disabled:hover:bg-transparent"
      title={busy ? t("more.wait") : undefined}
      onClick={busy ? undefined : onMore}
    >
      {t("more.load")}
    </Button>
  )
}
