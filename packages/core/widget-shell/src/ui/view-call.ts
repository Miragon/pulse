/** The rendering call's lifecycle as plain logic: what the frame shows, and when it re-runs. */
import type { ModelContextSpec } from "./ask-ai-prompt.js"
import type { CallObservation } from "./call-observer.js"

export type ViewPhase =
  | { phase: "waiting" }
  /** `reloadedAt`: the view re-ran its tool itself, so the figures can differ from the chat's. */
  | { phase: "ready"; data: object; reloadedAt: number | null }
  | { phase: "error"; error: Error }
  | { phase: "cancelled" }

export interface ViewCall {
  phase: ViewPhase
  /** The user's retry on the error state: one call of the view's show tool. */
  retry: () => void
}

/** The view's own call of its show tool: a stripped-result recovery or the user's retry. */
export type Rerun =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; data: object; at: number; recovered: boolean }
  | { state: "failed"; error: Error }

export interface ViewCallInputs {
  /** mcp-use's latch (`useToolContext().status`). */
  status: "pending" | "ready" | "error"
  output: unknown
  error: Error | undefined
  cancelled: boolean
  observation: CallObservation
  rerun: Rerun
}

/** What a view renders: a non-null, non-array object (`buildViewResult`'s data). */
export function isViewData(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const WAITING: ViewPhase = { phase: "waiting" }

/**
 * In order: the view's own successful re-run; the host's renderable result; a cancel; a re-run in
 * flight (waiting, so a retry is never clicked twice); its failure; the call's own error; a
 * stripped or unrenderable result (`recover`: re-run once); else still waiting. A slow tool, an
 * `isError` or a cancel is never re-run on its own: re-running a failure only repeats it. The
 * re-run checks no annotations, because every view-bound tool is a read (a server pins that, as
 * the Pulse app's `view-registry.test.ts` does).
 */
export function resolveViewCall(inputs: ViewCallInputs): { phase: ViewPhase; recover: boolean } {
  const { status, output, rerun } = inputs
  if (rerun.state === "done") {
    const reloadedAt = rerun.recovered ? rerun.at : null
    return { phase: { phase: "ready", data: rerun.data, reloadedAt }, recover: false }
  }
  if (status === "ready" && isViewData(output)) {
    return { phase: { phase: "ready", data: output, reloadedAt: null }, recover: false }
  }
  if (inputs.cancelled) return { phase: { phase: "cancelled" }, recover: false }
  if (rerun.state === "running") return { phase: WAITING, recover: false }
  if (rerun.state === "failed")
    return { phase: { phase: "error", error: rerun.error }, recover: false }
  if (status === "error") {
    const error = inputs.error ?? new Error("The tool call failed.")
    return { phase: { phase: "error", error }, recover: false }
  }
  const recover = status === "ready" || inputs.observation.result === "stripped"
  return { phase: WAITING, recover }
}

/**
 * The frame's own model line (read by the model, never shown, so English): an error or cancel
 * the user sees instead of the view, or figures the view re-loaded itself. `null` while waiting
 * and for a plain host-delivered view.
 */
export function viewCallContext(phase: ViewPhase): ModelContextSpec | null {
  switch (phase.phase) {
    case "waiting":
      return null
    case "cancelled":
      return {
        summary:
          "The view was cancelled before it rendered. The user sees a note that the call was cancelled.",
      }
    case "error":
      return {
        summary:
          "The view could not be shown. The user sees an error message with a retry button instead of the view.",
        untrusted: [{ label: "reason", text: phase.error.message }],
      }
    case "ready":
      if (phase.reloadedAt === null) return null
      return {
        summary:
          "The view re-ran its tool because the host did not pass the result to the view; its figures are live as of liveAsOf and can differ from the result in the chat.",
        facts: { liveAsOf: new Date(phase.reloadedAt).toISOString() },
      }
  }
}
