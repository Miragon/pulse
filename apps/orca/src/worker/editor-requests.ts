import type { OrcaWorkerApi, PanelCaller } from "orca/worker"
import type { BoardViews } from "./board-views.js"
import type { CockpitViews } from "./cockpit-views.js"

export class EditorRequests {
  constructor(
    private readonly orca: OrcaWorkerApi,
    private readonly views: CockpitViews,
    private readonly boards: BoardViews,
    private readonly ready: () => Promise<void>,
  ) {}

  register(): void {
    const { panels } = this.orca
    panels.handle("cockpit.attach", async ({ handle }, { panel }) => {
      await this.ready()
      return this.views.attach(panel.id, handle)
    })
    panels.handle("cockpit.watch", ({ visible }, { panel, signal }) => {
      if (visible) {
        this.focus(panel)
      }
      return this.views.surfaces.watch(panel.id, visible, signal)
    })
    panels.handle("cockpit.intent", ({ intent }, { panel }) =>
      this.boards.knows(panel.id)
        ? this.boards.intent(panel.id, intent)
        : this.views.intent(panel.id, intent),
    )
    panels.handle("board.attach", async ({ text }, { panel }) => {
      await this.ready()
      this.boards.attach(panel.id, text)
      return { attached: true }
    })
    panels.handle("board.changed", ({ text }, { panel }) => ({
      known: this.boards.changed(panel.id, text),
    }))
  }

  private focus(panel: PanelCaller): void {
    const key = this.views.focusOf(panel.id)
    if (key !== undefined) {
      this.orca.panels.post("engines.focus", { key })
    }
  }
}
