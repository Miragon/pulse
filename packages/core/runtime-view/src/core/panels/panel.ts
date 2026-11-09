import type { WebviewIntent } from "../protocol/index.js"
import type { Attention } from "../refresh/live-context.js"

export interface Panel {
  handle(intent: WebviewIntent): Promise<void>
  attend(attention: Attention): void
  nudge(): void
  dispose(): void
}
