interface EditorDocument {
  readonly content: { readonly text?: string }
}

interface OrcaFrame {
  readonly document: {
    get(): Promise<EditorDocument>
    onDidChange(handler: (document: EditorDocument) => void): unknown
  }
  readonly plugin: {
    request(name: string, input: unknown, options?: { timeoutMs?: number }): Promise<unknown>
    on(event: string, handler: (payload: unknown) => void): unknown
  }
  readonly shell?: { openExternal(url: string): Promise<unknown> }
  on(event: "theme", handler: (theme: { readonly colorScheme: "light" | "dark" }) => void): unknown
}

interface FrameGlobals {
  readonly orca: OrcaFrame
  acquireVsCodeApi?: () => unknown
}

type FrameAction =
  | { readonly kind: "copy"; readonly text: string }
  | { readonly kind: "openExternal"; readonly url: string }

interface FrameClipboard {
  execCommand(command: "copy"): boolean
}

interface IntentAnswer {
  readonly known: boolean
  readonly actions?: readonly FrameAction[]
}

const WATCH_TIMEOUT_MS = 120_000
const RECONNECT_AFTER_MS = 2000

class OrcaFrameBridge {
  private attached = false
  private readonly queue: unknown[] = []
  private state: unknown
  private readonly board = document.documentElement.dataset.pulseSurface === "board"

  constructor(private readonly orca: OrcaFrame) {}

  install(globals: FrameGlobals): void {
    OrcaFrameBridge.applyTheme(
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    )
    globals.acquireVsCodeApi = () => ({
      postMessage: (intent: unknown) => {
        this.post(intent)
      },
      getState: () => this.state,
      setState: (next: unknown) => {
        this.state = next
      },
    })
    this.orca.plugin.on("cockpit.state", (payload) => {
      window.dispatchEvent(
        new MessageEvent("message", { data: (payload as { message: unknown }).message }),
      )
    })
    this.orca.on("theme", ({ colorScheme }) => {
      OrcaFrameBridge.applyTheme(colorScheme)
      const appearance = { type: "modelerShell.appearance", appearance: { theme: colorScheme } }
      window.dispatchEvent(new MessageEvent("message", { data: appearance }))
    })
    document.addEventListener("visibilitychange", () => {
      this.watch()
    })
    this.attach().catch(() => {
      OrcaFrameBridge.reconnectLater()
    })
  }

  private async attach(): Promise<void> {
    const current = await this.orca.document.get()
    const text = current.content.text ?? ""
    const answer = (await this.orca.plugin.request(this.board ? "board.attach" : "cockpit.attach", {
      [this.board ? "text" : "handle"]: text,
    })) as { attached: boolean; problem?: string }
    if (!answer.attached) {
      OrcaFrameBridge.showProblem(answer.problem ?? "Pulse can't open this view.")
      return
    }
    if (this.board) {
      this.orca.document.onDidChange((changed) => {
        void this.orca.plugin.request("board.changed", { text: changed.content.text ?? "" })
      })
    }
    this.attached = true
    this.watch()
    for (const intent of this.queue.splice(0)) {
      this.post(intent)
    }
  }

  private watch(): void {
    if (!this.attached) {
      return
    }
    const visible = document.visibilityState === "visible"
    void this.orca.plugin
      .request("cockpit.watch", { visible }, { timeoutMs: WATCH_TIMEOUT_MS })
      .then((answer) => {
        if ((answer as { again: boolean }).again) {
          this.watch()
        }
      })
      .catch(() => {
        OrcaFrameBridge.reconnectLater()
      })
  }

  private post(intent: unknown): void {
    if (OrcaFrameBridge.isCopy(intent)) {
      OrcaFrameBridge.copy(intent.text)
      return
    }
    if (!this.attached) {
      this.queue.push(intent)
      return
    }
    void this.orca.plugin
      .request("cockpit.intent", { intent })
      .then((answer) => {
        this.answered(answer as IntentAnswer)
      })
      .catch(() => undefined)
  }

  private answered(answer: IntentAnswer): void {
    if (!answer.known) {
      window.location.reload()
      return
    }
    for (const action of answer.actions ?? []) {
      if (action.kind === "copy") {
        OrcaFrameBridge.copy(action.text)
      } else {
        void this.orca.shell?.openExternal(action.url)
      }
    }
  }

  private static isCopy(
    intent: unknown,
  ): intent is { readonly type: "copy"; readonly text: string } {
    const candidate = intent as { readonly type?: unknown; readonly text?: unknown }
    return candidate.type === "copy" && typeof candidate.text === "string"
  }

  private static copy(text: string): void {
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.append(area)
    area.select()
    ;(document as unknown as FrameClipboard).execCommand("copy")
    area.remove()
  }

  private static reconnectLater(): void {
    console.info("Pulse lost its worker; this view reconnects")
    setTimeout(() => {
      window.location.reload()
    }, RECONNECT_AFTER_MS)
  }

  private static applyTheme(theme: "light" | "dark"): void {
    document.documentElement.dataset.cdTheme = theme
  }

  private static showProblem(text: string): void {
    const notice = document.createElement("p")
    notice.className = "pulse-orca-problem"
    notice.textContent = text
    document.body.prepend(notice)
  }
}

const globals = globalThis as unknown as FrameGlobals
new OrcaFrameBridge(globals.orca).install(globals)
