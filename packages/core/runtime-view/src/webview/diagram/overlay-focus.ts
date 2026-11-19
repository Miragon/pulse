export interface HeldOverlayFocus {
  readonly elementId: string
  readonly selector: string
}

export class OverlayFocus {
  static held(anchors: readonly HTMLElement[]): HeldOverlayFocus | undefined {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) {
      return undefined
    }
    const elementId = anchors.find((anchor) => anchor.contains(active))?.dataset.overlayFor
    if (elementId === undefined) {
      return undefined
    }
    return { elementId, selector: OverlayFocus.selectorOf(active) }
  }

  static restore(anchors: readonly HTMLElement[], held: HeldOverlayFocus | undefined): void {
    if (held === undefined || OverlayFocus.isElsewhere()) {
      return
    }
    const own = anchors.filter((anchor) => anchor.dataset.overlayFor === held.elementId)
    const target =
      OverlayFocus.first(own, held.selector) ?? OverlayFocus.first(own, "button, [tabindex]")
    target?.focus()
  }

  private static selectorOf(element: HTMLElement): string {
    const part = element.getAttribute("data-part")
    const scope = element.getAttribute("data-scope")
    const byPart =
      part === null ? element.tagName.toLowerCase() : `[data-part="${CSS.escape(part)}"]`
    return scope === null ? byPart : `${byPart}[data-scope="${CSS.escape(scope)}"]`
  }

  private static first(anchors: readonly HTMLElement[], selector: string): HTMLElement | undefined {
    for (const anchor of anchors) {
      const found = anchor.querySelector<HTMLElement>(selector)
      if (found !== null) {
        return found
      }
    }
    return undefined
  }

  private static isElsewhere(): boolean {
    const active = document.activeElement
    return active !== null && active !== document.body
  }
}
