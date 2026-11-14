import { render, type VNode } from "preact"

export type OverlayKind = "badges" | "call" | "actions" | "move"

export interface OverlaySlot {
  readonly key: string
  readonly anchor: HTMLElement
  readonly node: VNode
}

export interface OverlaySink {
  render(slots: readonly OverlaySlot[], rendered: () => void): void
}

export class PreactOverlaySink implements OverlaySink {
  private shown: readonly OverlaySlot[] = []

  render(slots: readonly OverlaySlot[], rendered: () => void): void {
    if (slots !== this.shown) {
      const kept = new Set(slots.map((slot) => slot.anchor))
      for (const gone of this.shown.filter((slot) => !kept.has(slot.anchor))) {
        render(null, gone.anchor)
      }
      for (const slot of slots) {
        render(slot.node, slot.anchor)
      }
      this.shown = slots
    }
    rendered()
  }
}
