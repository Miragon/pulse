import type { Connection } from "@miragon/pulse-runtime-view/host-kit"
import type { OrcaWorkerApi } from "orca/worker"
import type { EngineRegistry } from "./engine-registry.js"

const ITEM = "engine"
const ENVIRONMENT_NAMES = {
  local: "LOCAL",
  test: "TEST",
  production: "PROD",
  unclassified: "",
} as const
const GLANCE_REUSE_MS = 60_000

export class StatusBar {
  private pendingPrompts = 0
  private ticket = 0
  private watching: (() => void) | undefined
  private watched: Connection | undefined

  constructor(
    private readonly orca: OrcaWorkerApi,
    private readonly registry: EngineRegistry,
  ) {
    const render = () => void this.render()
    registry.onDidChange(render)
    registry.onDidWrite(render)
  }

  prompts(count: number): void {
    this.pendingPrompts = count
    void this.render()
  }

  async render(): Promise<void> {
    const ticket = ++this.ticket
    const active = this.registry.active()
    this.watch(active)
    if (active === undefined) {
      await this.update({ visible: false })
      return
    }
    if (this.pendingPrompts > 0) {
      await this.update({
        visible: true,
        text: "Confirm in the Pulse panel",
        icon: "warning",
        tone: "warning",
        tooltip: "A Pulse write waits for your answer in the Pulse panel.",
      })
      return
    }
    const incidents = await this.incidentsOf(active)
    if (ticket === this.ticket) {
      await this.update(this.engineItem(active, incidents))
    }
  }

  private engineItem(connection: Connection, incidents: number | undefined) {
    const environment = ENVIRONMENT_NAMES[connection.badge.environment]
    const parts = [
      connection.target.name,
      environment,
      incidents === undefined ? "" : `${incidents} with incident`,
    ]
    return {
      visible: true,
      text: parts.filter(Boolean).join(" · "),
      icon: connection.commands === undefined ? ("database" as const) : ("edit" as const),
      tone: StatusBar.toneOf(connection, incidents),
      tooltip: `${connection.target.name} · ${connection.target.endpoint} · ${connection.badge.access?.note ?? "Read-only."} Click to open its processes.`,
    }
  }

  private static toneOf(connection: Connection, incidents: number | undefined) {
    if (connection.badge.environment === "production") {
      return "danger" as const
    }
    return incidents !== undefined && incidents > 0 ? ("warning" as const) : ("neutral" as const)
  }

  private async incidentsOf(connection: Connection): Promise<number | undefined> {
    if (connection.lane.isBlocked) {
      return undefined
    }
    const summaries = await connection.definitions.read(GLANCE_REUSE_MS).catch(() => undefined)
    return summaries?.reduce((sum, summary) => sum + summary.withIncident, 0)
  }

  private watch(connection: Connection | undefined): void {
    if (connection === this.watched) {
      return
    }
    this.watching?.()
    this.watched = connection
    this.watching = connection?.definitions.subscribe(() => {
      void this.render()
    })
  }

  private async update(fields: Readonly<Record<string, unknown>>): Promise<void> {
    await this.orca.host
      .call("statusBar.update", { id: ITEM, ...fields })
      .catch((error: unknown) => {
        this.orca.log(`status bar: ${String(error)}`)
      })
  }
}
