import type { Environment } from "./view-models.js"

export type PauseReason = "user" | "background" | "idle" | "editing"

export type LiveUpdates =
  | { readonly status: "live"; readonly everySeconds: number }
  | { readonly status: "paused"; readonly reason: PauseReason }
  | { readonly status: "reconnecting"; readonly retryAt: string }
  | { readonly status: "ended" }
  | { readonly status: "stopped"; readonly reason: "refused" | "gone" }
  | {
      readonly status: "off"
      readonly environment: Environment
      readonly everySeconds: number
    }
