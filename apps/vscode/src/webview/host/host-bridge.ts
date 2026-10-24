import type {
  BackLink,
  PanelState,
  StateMessage,
  WebviewIntent,
} from "../../core/protocol/index.js"

export interface VsCodeApi {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

type StateListener = (state: PanelState) => void

export class HostBridge {
  private readonly listeners = new Set<StateListener>()
  private revision = Number.NEGATIVE_INFINITY
  private latest: PanelState | undefined
  private latestBack: BackLink | undefined
  private readonly onMessage: (event: MessageEvent) => void

  constructor(
    readonly api: VsCodeApi,
    private readonly target: Window = window,
  ) {
    this.onMessage = (event) => {
      this.receive(event.data)
    }
    target.addEventListener("message", this.onMessage)
  }

  post(intent: WebviewIntent): void {
    this.api.postMessage(intent)
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    if (this.latest !== undefined) {
      listener(this.latest)
    }
    return () => this.listeners.delete(listener)
  }

  current(): PanelState | undefined {
    return this.latest
  }

  back(): BackLink | undefined {
    return this.latestBack
  }

  dispose(): void {
    this.target.removeEventListener("message", this.onMessage)
    this.listeners.clear()
  }

  private receive(message: unknown): void {
    if (!HostBridge.isStateMessage(message) || message.revision <= this.revision) {
      return
    }
    this.revision = message.revision
    this.latest = message.state
    this.latestBack = message.back
    for (const listener of this.listeners) {
      listener(message.state)
    }
  }

  private static isStateMessage(value: unknown): value is StateMessage {
    if (typeof value !== "object" || value === null) {
      return false
    }
    const candidate = value as Partial<StateMessage>
    return (
      candidate.type === "state" &&
      typeof candidate.revision === "number" &&
      typeof candidate.state === "object"
    )
  }
}
