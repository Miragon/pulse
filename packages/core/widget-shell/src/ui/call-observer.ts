/**
 * A passive observer of the host → view lifecycle notifications (SEP-1865), read off the
 * postMessage channel the view runtime listens on. mcp-use latches only a result WITH
 * `structuredContent` (or an `isError`); claude.ai and Claude Desktop forward the result without
 * it, so the latch stays pending. Watching the notifications tells a stripped result (re-run the
 * show tool now) from a slow tool (keep waiting). Read-only: it never sends, answers or stops a
 * message. No React, no mcp-use.
 */

export interface CallObservation {
  /** The arguments of the COMPLETE `ui/notifications/tool-input`; partial streams are ignored. */
  readonly args: Readonly<Record<string, unknown>> | undefined
  readonly result: "none" | "structured" | "stripped" | "error"
  readonly cancelled: boolean
}

export const NO_CALL_OBSERVATION: CallObservation = Object.freeze({
  args: undefined,
  result: "none",
  cancelled: false,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Like mcp-use's latch: `isError` is an error, any `structuredContent` (even null) latches. */
function resultKind(params: Record<string, unknown>): CallObservation["result"] {
  if (params.isError === true) return "error"
  return params.structuredContent === undefined ? "stripped" : "structured"
}

/**
 * Folds one postMessage payload (JSON-RPC 2.0 only) into the observation. The call settles once:
 * after its result or a cancel, nothing changes it.
 */
export function reduceCallObservation(state: CallObservation, data: unknown): CallObservation {
  if (!isRecord(data) || data.jsonrpc !== "2.0" || typeof data.method !== "string") return state
  if (state.result !== "none" || state.cancelled) return state
  const params = isRecord(data.params) ? data.params : {}
  switch (data.method) {
    case "ui/notifications/tool-input":
      return { ...state, args: isRecord(params.arguments) ? params.arguments : {} }
    case "ui/notifications/tool-result":
      return { ...state, result: resultKind(params) }
    case "ui/notifications/tool-cancelled":
      return { ...state, cancelled: true }
    default:
      return state
  }
}

/** A subscribable observation, shaped for `useSyncExternalStore`. */
export interface CallObserver {
  subscribe(listener: () => void): () => void
  getSnapshot(): CallObservation
  /** Stops listening; the last observation stays readable. */
  dispose(): void
}

export function createCallObserver(
  source: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  accept: (event: MessageEvent) => boolean,
): CallObserver {
  let snapshot = NO_CALL_OBSERVATION
  const listeners = new Set<() => void>()
  const onMessage = (received: Event) => {
    // Only `message` is subscribed, so every event is a MessageEvent.
    const event = received as MessageEvent
    if (!accept(event)) return
    const next = reduceCallObservation(snapshot, event.data)
    if (next === snapshot) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  source.addEventListener("message", onMessage)
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    dispose: () => source.removeEventListener("message", onMessage),
  }
}

let installed: CallObserver | null = null

/**
 * The document's observer, installed once BEFORE `bootstrapView` (`mountView`): notifications
 * follow the `ui/initialize` handshake, so a result it has not seen was not sent. Listens only to
 * the framing host (`event.source === window.parent`); `null` at top level and without a window.
 */
export function installCallObserver(): CallObserver | null {
  if (installed) return installed
  if (typeof window === "undefined" || window.parent === window) return null
  const host = window.parent
  installed = createCallObserver(window, (event) => event.source === host)
  return installed
}
