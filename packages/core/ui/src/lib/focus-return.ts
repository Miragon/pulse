import { useState } from "react"

/**
 * Focus return for the kit's dialogs (CI §12: focus goes back to where it
 * came from).
 *
 * A Radix dialog returns the focus only to its `Trigger`. The kit's overlays
 * mostly open from React state, without one (a confirmation a row action
 * opens), and Radix then cancels its focus scope's own restore and focuses
 * nothing: closing them by keyboard left the focus on the document body.
 * `DialogContent` therefore notes the element that has the focus as it opens
 * and hands the focus back to it when it closes and the focus went with it,
 * while that element is still in the document. A consumer's own
 * `onCloseAutoFocus` that calls `preventDefault()` keeps full control.
 */

/** The part of an element the hand-back needs (structural, so it tests without a DOM). */
interface FocusReturnTarget {
  readonly isConnected: boolean
  focus: () => void
}

/** The part of Radix's auto-focus events the hand-back reads. */
export interface AutoFocusEventLike {
  readonly defaultPrevented: boolean
  preventDefault: () => void
}

/** One overlay's hand-back, from {@link createFocusReturn}. */
export interface FocusReturn {
  /**
   * Notes the element that has the focus as the overlay opens. The document
   * body is no target: a pointer that opened it without focusing anything
   * (Safari does not focus a clicked button) leaves Radix's default in place.
   */
  capture: (active: FocusReturnTarget | null, body: unknown) => void
  /**
   * Hands the focus back to the noted element when the overlay closes and the
   * focus went with it (`focusLost`: it sits on the body). It leaves the focus
   * where it is when a handler before it prevented that, when the focus
   * already sits elsewhere (a click outside a non-modal overlay, a hand-off
   * that moved it) or when the element left the document (an action that
   * unmounted it). Forgets the element either way.
   */
  restore: (event: AutoFocusEventLike, focusLost: boolean) => void
}

/** A {@link FocusReturn} with nothing noted yet. */
export function createFocusReturn(): FocusReturn {
  let opener: FocusReturnTarget | null = null
  return {
    capture: (active, body) => {
      opener = active === body ? null : active
    },
    restore: (event, focusLost) => {
      const target = opener
      opener = null
      if (event.defaultPrevented || !focusLost || target === null || !target.isConnected) return
      event.preventDefault()
      target.focus()
    },
  }
}

/**
 * The `onOpenAutoFocus` / `onCloseAutoFocus` pair of a Radix dialog content
 * with the focus hand-back of {@link createFocusReturn} composed in: it notes
 * the opener BEFORE the consumer's open handler runs (that one may move the
 * focus) and hands it back AFTER the consumer's close handler (whose
 * `preventDefault()` keeps it out). Radix fires the open event only when the
 * focus is outside the content as it mounts, so an element inside it must not
 * take the focus itself (`autoFocus`): Radix focuses the first one anyway.
 */
export function useFocusReturn<E extends AutoFocusEventLike>(handlers: {
  onOpenAutoFocus?: (event: E) => void
  onCloseAutoFocus?: (event: E) => void
}): { onOpenAutoFocus: (event: E) => void; onCloseAutoFocus: (event: E) => void } {
  const [focusReturn] = useState(createFocusReturn)
  return {
    onOpenAutoFocus: (event) => {
      focusReturn.capture(activeElementOf(document), document.body)
      handlers.onOpenAutoFocus?.(event)
    },
    onCloseAutoFocus: (event) => {
      handlers.onCloseAutoFocus?.(event)
      const active = document.activeElement
      focusReturn.restore(event, active === null || active === document.body)
    },
  }
}

function activeElementOf(doc: Document): FocusReturnTarget | null {
  const active = doc.activeElement
  return active && "focus" in active ? (active as HTMLElement) : null
}
