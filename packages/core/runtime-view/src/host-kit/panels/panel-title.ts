import type { PanelState, PanelView } from "../../core/protocol/index.js"

export class PanelTitle {
  static ofEngine(name: string): string {
    return `${name} · Processes`
  }

  static ofBoard(title: string): string {
    return `${title} · Board`
  }

  static of(state: PanelState, fallback: string): string {
    const view = PanelTitle.viewOf(state)
    if (view === undefined) {
      return fallback
    }
    if (view.kind === "board") {
      return PanelTitle.ofBoard(view.title)
    }
    if (view.kind === "engine") {
      return PanelTitle.ofEngine(view.engine.name)
    }
    if (view.kind === "definition") {
      return `${view.processName} · ${view.engine.name}`
    }
    if (view.kind === "migrationPlan") {
      return `${view.fileName} · Preview · ${view.engine.name}`
    }
    if (view.kind === "migration") {
      const target = view.target === undefined ? "…" : `v${view.target.version}`
      return `${view.processName} v${view.source.version} → ${target} · ${view.engine.name}`
    }
    return `${view.instance.businessKey ?? view.instance.shortId} · ${view.instance.processName}`
  }

  private static viewOf(state: PanelState): PanelView | undefined {
    if (state.status === "ready") {
      return state.view
    }
    return state.status === "failed" ? state.staleView : undefined
  }
}
