import type { ReactNode } from "react"
import { flushSync } from "react-dom"

export type OverlayKind = "badges" | "call" | "actions" | "move"

export interface OverlaySlot {
  readonly key: string
  readonly anchor: HTMLElement
  readonly node: ReactNode
}

export interface OverlaySink {
  render(slots: readonly OverlaySlot[], rendered: () => void): void
}

export class ReactOverlaySink implements OverlaySink {
  private shown: readonly OverlaySlot[] = []
  private attached = true

  constructor(private readonly publish: (slots: readonly OverlaySlot[]) => void) {}

  render(slots: readonly OverlaySlot[], rendered: () => void): void {
    if (this.attached && slots !== this.shown) {
      this.shown = slots
      flushSync(() => {
        this.publish(slots)
      })
    }
    rendered()
  }

  detach(): void {
    this.attached = false
    this.shown = []
    this.publish([])
  }
}
