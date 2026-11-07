import { watch, type FSWatcher } from "node:fs"
import type { OrcaWorkerApi } from "orca/worker"
import type { ViewRequest } from "../protocol.js"
import type { EngineRegistry } from "./engine-registry.js"
import type { OrcaWorkspaces } from "./orca-workspaces.js"
import type { WorkerServices } from "./worker-services.js"

const RELOAD_DELAY_MS = 300
const QUIET_AFTER_NUDGE_MS = 5000

export interface TriggerParts {
  readonly registry: EngineRegistry
  readonly workspaces: OrcaWorkspaces
  readonly services: WorkerServices
  readonly nudgeLocal: () => void
  readonly openView: (request: ViewRequest) => void
  readonly ready: () => Promise<void>
}

export class WorkerTriggers {
  private watchers: FSWatcher[] = []
  private reloadTimer: ReturnType<typeof setTimeout> | undefined
  private lastNudge = Number.NEGATIVE_INFINITY

  constructor(
    private readonly orca: OrcaWorkerApi,
    private readonly parts: TriggerParts,
  ) {}

  register(): void {
    this.commands()
    this.orca.events.on("workspace.changed", ({ context }) => {
      this.parts.workspaces.noteFocus(context)
      void this.followFocus()
    })
    this.orca.hooks.on("editor.save.before", (event, next) => {
      if (event.path.endsWith(".bpmn")) {
        this.nudge()
      }
      return next(event)
    })
    this.orca.settings.onDidChange(({ key }) => {
      if (key.startsWith("liveUpdates.")) {
        void this.parts.registry.applyLiveSettings()
        return
      }
      this.reloadSoon()
    })
    this.parts.registry.onDidChange(() => {
      this.watchProjectFiles()
    })
  }

  dispose(): void {
    clearTimeout(this.reloadTimer)
    for (const watcher of this.watchers) {
      watcher.close()
    }
    this.watchers = []
  }

  private commands(): void {
    const { registry, services } = this.parts
    const active = () => registry.active()?.target.name
    this.command("refresh", async () => {
      await registry.reload()
      return "Pulse reloaded its engines."
    })
    this.command("openEngineOverview", () => {
      const engine = active()
      if (engine === undefined) {
        return "Pulse has no engine to open."
      }
      this.parts.openView({ engine, view: "engine" })
      return `Opening ${engine}.`
    })
    this.command("switchEngine", async () => {
      const names = registry.all().map((connection) => connection.target.name)
      const next = names[(names.indexOf(active() ?? "") + 1) % names.length]
      if (next === undefined) {
        return "Pulse has no engine to switch to."
      }
      await registry.activate(next)
      return `Pulse now works with ${next}.`
    })
    this.command("configureEngines", async () => `Opened ${await services.configure()}.`)
  }

  private command(id: string, run: () => unknown): void {
    this.orca.commands.register(`pulse.${id}`, async () => {
      await this.parts.ready()
      return run()
    })
  }

  private nudge(): void {
    if (Date.now() - this.lastNudge < QUIET_AFTER_NUDGE_MS) {
      return
    }
    this.lastNudge = Date.now()
    for (const connection of this.parts.registry.all()) {
      if (connection.badge.environment === "local") {
        connection.definitions.forget()
      }
    }
    this.parts.nudgeLocal()
  }

  private async followFocus(): Promise<void> {
    const configured = await this.orca.settings.get("projectFile")
    if (typeof configured !== "string" || configured.trim() === "") {
      this.reloadSoon()
    }
  }

  private reloadSoon(): void {
    clearTimeout(this.reloadTimer)
    this.reloadTimer = setTimeout(() => {
      void this.parts.registry.reload().catch((error: unknown) => {
        this.orca.log(`reload failed: ${String(error)}`)
      })
    }, RELOAD_DELAY_MS)
  }

  private watchProjectFiles(): void {
    for (const watcher of this.watchers) {
      watcher.close()
    }
    this.watchers = this.parts.registry.projectFiles().flatMap((file) => {
      try {
        return [
          watch(file, () => {
            this.reloadSoon()
          }),
        ]
      } catch {
        return []
      }
    })
  }
}
