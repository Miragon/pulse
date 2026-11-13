import {
  StatePublisher,
  type Attention,
  type Panel,
  type PanelContext,
} from "@miragon/pulse-runtime-view/core"
import type { BackLink, PanelState, WebviewIntent } from "@miragon/pulse-runtime-view/protocol"
import { type Connection, PanelTitle } from "@miragon/pulse-runtime-view/host-kit"
import type { OrcaWorkerApi } from "orca/worker"
import type { FrameAction } from "../protocol.js"

const GESTURE_WINDOW_MS = 3000

export type ContextFactory = (
  connection: Connection,
  publish: (state: PanelState) => void,
) => PanelContext
export type PanelFactory = (context: PanelContext) => Panel

export class CockpitView {
  private readonly frames = new Set<string>()
  private current: Panel
  private collector: FrameAction[] | undefined
  private title: string
  private readonly publisher: StatePublisher

  constructor(
    private readonly orca: OrcaWorkerApi,
    private connection: Connection,
    private readonly create: { readonly panel: PanelFactory; readonly context: ContextFactory },
    private readonly backOf: () => BackLink | undefined,
  ) {
    this.title = connection.target.name
    this.publisher = new StatePublisher((message) => {
      const back = this.backOf()
      const posted = back === undefined ? message : { ...message, back }
      for (const frame of this.frames) {
        this.orca.panels.post("cockpit.state", { message: posted }, { panel: frame })
      }
    })
    this.current = this.newPanel()
  }

  get engineName(): string {
    return this.connection.target.name
  }

  get label(): string {
    return this.title
  }

  get isEmpty(): boolean {
    return this.frames.size === 0
  }

  attach(frame: string): void {
    this.frames.add(frame)
  }

  detach(frame: string): void {
    this.frames.delete(frame)
  }

  async intent(intent: WebviewIntent): Promise<readonly FrameAction[]> {
    const actions: FrameAction[] = []
    this.collector = actions
    const handled = this.current.handle(intent).catch((error: unknown) => {
      this.orca.log(`intent ${intent.type} failed: ${String(error)}`)
    })
    await Promise.race([handled, new Promise((resolve) => setTimeout(resolve, GESTURE_WINDOW_MS))])
    if (this.collector === actions) {
      this.collector = undefined
    }
    return actions
  }

  frameAction(action: FrameAction): void {
    if (this.collector === undefined) {
      this.orca.log(`${action.kind} needs a click in the view; it came too late`)
      return
    }
    this.collector.push(action)
  }

  rebind(connection: Connection): void {
    if (connection === this.connection) {
      return
    }
    this.connection = connection
    this.current.dispose()
    this.current = this.newPanel()
    if (!this.isEmpty && !connection.lane.isBlocked) {
      void this.current.handle({ type: "ready" })
    }
  }

  attend(attention: Attention): void {
    this.current.attend(attention)
  }

  nudgeLocal(): void {
    if (this.connection.badge.environment === "local") {
      this.current.nudge()
    }
  }

  dispose(): void {
    this.current.dispose()
    this.frames.clear()
  }

  private newPanel(): Panel {
    return this.create.panel(
      this.create.context(this.connection, (state) => {
        this.title = PanelTitle.of(state, this.title)
        this.publisher.publish(state)
      }),
    )
  }
}
