import type { Viewbox } from "./runtime-canvas.js"

export interface LinkedView {
  viewbox(): Viewbox
  showViewbox(box: Viewbox): void
}

const CLOSE = 0.5

export class ViewLink {
  private applying = false

  follow(from: LinkedView | undefined, to: LinkedView | undefined): void {
    if (this.applying || from === undefined || to === undefined) {
      return
    }
    const wanted = from.viewbox()
    if (ViewLink.same(wanted, to.viewbox())) {
      return
    }
    this.applying = true
    try {
      to.showViewbox(wanted)
    } finally {
      this.applying = false
    }
  }

  private static same(left: Viewbox, right: Viewbox): boolean {
    return (
      Math.abs(left.x - right.x) < CLOSE &&
      Math.abs(left.y - right.y) < CLOSE &&
      Math.abs(left.width - right.width) < CLOSE &&
      Math.abs(left.height - right.height) < CLOSE
    )
  }
}
