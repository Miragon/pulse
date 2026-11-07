interface OrcaFrame {
  readonly document: { get(): Promise<{ readonly content: { readonly text?: string } }> }
  readonly plugin: {
    request(name: string, input: unknown): Promise<unknown>
    on(event: string, handler: (payload: unknown) => void): unknown
  }
  on(event: "theme", handler: (theme: { readonly colorScheme: "light" | "dark" }) => void): unknown
}

interface FrameGlobals {
  readonly orca: OrcaFrame
  acquireVsCodeApi?: () => unknown
}

class OrcaFrameBridge {
  private attached = false
  private readonly queue: unknown[] = []
  private state: unknown

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
    void this.attach()
  }

  private async attach(): Promise<void> {
    const document = await this.orca.document.get()
    const answer = (await this.orca.plugin.request("cockpit.attach", {
      handle: document.content.text ?? "",
    })) as { attached: boolean; problem?: string }
    if (!answer.attached) {
      OrcaFrameBridge.showProblem(answer.problem ?? "Pulse can't open this view.")
      return
    }
    this.attached = true
    for (const intent of this.queue.splice(0)) {
      this.post(intent)
    }
  }

  private post(intent: unknown): void {
    if (!this.attached) {
      this.queue.push(intent)
      return
    }
    void this.orca.plugin.request("cockpit.intent", { intent }).then((answer) => {
      if (!(answer as { known: boolean }).known) {
        window.location.reload()
      }
    })
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
