import type { OrcaWorkerApi, PanelCaller } from "orca/worker"
import type { TargetsProblem } from "@miragon/pulse-runtime-view/host-kit"
import type { ConfigurationProblem, EngineList, ViewRequest } from "../protocol.js"
import { BoardTemplate } from "./board-template.js"
import type { CockpitViews } from "./cockpit-views.js"
import { EngineRows } from "./engine-rows.js"
import type { EngineRegistry } from "./engine-registry.js"
import type { EnginesLive } from "./engines-live.js"
import { InstanceFinder } from "./instance-finder.js"
import type { LocalFiles } from "./local-files.js"
import type { OrcaSettings } from "./orca-settings.js"
import type { OrcaWorkspaces } from "./orca-workspaces.js"
import type { Prompts } from "./prompts.js"
import { SurfaceWatch } from "./surface-watch.js"
import type { WorkerServices } from "./worker-services.js"

const PULSE_PANEL = "engines"

export interface PanelParts {
  readonly registry: EngineRegistry
  readonly settings: OrcaSettings
  readonly prompts: Prompts
  readonly views: CockpitViews
  readonly services: WorkerServices
  readonly files: LocalFiles
  readonly live: EnginesLive
  readonly workspaces: OrcaWorkspaces
  readonly ready: () => Promise<void>
}

export class PanelRequests {
  private readonly visible = new Set<string>()
  private readonly surfaces: SurfaceWatch

  constructor(
    private readonly orca: OrcaWorkerApi,
    private readonly parts: PanelParts,
  ) {
    this.surfaces = new SurfaceWatch({
      changed: (panel, visible) => {
        this.show(panel, visible)
      },
      closed: (panel) => {
        this.show(panel, false)
      },
    })
  }

  register(): void {
    const { panels } = this.orca
    const { registry, services, prompts } = this.parts
    panels.handle("engines.list", () => this.list())
    panels.handle("engines.watch", ({ visible }, { panel, signal }) =>
      this.surfaces.watch(panel.id, visible, signal),
    )
    panels.handle("engines.activate", async ({ engine }) => {
      await registry.activate(engine)
      return { ok: true }
    })
    panels.handle("engines.setProjectFile", async ({ path }) => {
      await this.parts.settings.setProjectFile(path)
      await registry.reload()
      return { ok: true }
    })
    panels.handle("engines.setCredentials", ({ engine, username, password }) =>
      this.saveLogin(engine, username, password),
    )
    panels.handle("engines.configure", async () => ({ path: await services.configure() }))
    panels.handle("instances.find", ({ query }) => this.find(query))
    panels.handle("boards.list", () => this.boards())
    panels.handle("boards.open", async ({ path }) => {
      await this.parts.workspaces.openFile(path)
      return { ok: true }
    })
    panels.handle("boards.create", ({ title }) => this.createBoard(title))
    panels.handle("models.list", () => this.models())
    panels.handle("prompts.list", () => ({ prompts: prompts.list() }))
    panels.handle("prompts.answer", ({ id, answer }, { panel }) => {
      const allowed = PanelRequests.isPulsePanel(panel)
      if (!allowed) {
        this.orca.log(`prompt answer refused from ${panel.surface} ${panel.contributionId}`)
      }
      return { ok: allowed && prompts.answer(id, answer) }
    })
    panels.handle("views.open", async (request: ViewRequest) => {
      await this.parts.ready()
      return { path: await this.parts.views.open(request) }
    })
  }

  dispose(): void {
    this.surfaces.dispose()
  }

  private async list(): Promise<EngineList> {
    await this.parts.ready()
    const { registry } = this.parts
    const active = registry.active()
    return {
      projectFile: registry.projectFiles()[0] ?? "",
      engines: await Promise.all(
        registry.all().map((connection) => EngineRows.of(connection, connection === active)),
      ),
      problems: registry.configurationProblems().map((problem) => PanelRequests.shown(problem)),
    }
  }

  private static shown(problem: TargetsProblem): ConfigurationProblem {
    return { text: problem.label(), tone: problem.severity === "warning" ? "warning" : "danger" }
  }

  private async boards() {
    await this.parts.ready()
    return { boards: await this.parts.files.boards() }
  }

  private async models() {
    await this.parts.ready()
    return { models: await this.parts.files.models() }
  }

  private async find(query: string) {
    await this.parts.ready()
    const active = this.parts.registry.active()
    return { found: active === undefined ? [] : await InstanceFinder.find(active, query) }
  }

  private async createBoard(title: string): Promise<{ path: string }> {
    await this.parts.ready()
    const engines = this.parts.registry.all().map((connection) => connection.target.name)
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "board"
    const path = await this.parts.files.createBoard(
      await this.parts.services.root(),
      slug,
      BoardTemplate.of(title, engines),
    )
    await this.parts.workspaces.openFile(path)
    return { path }
  }

  private async saveLogin(
    engine: string,
    username: string,
    password: string,
  ): Promise<{ ok: boolean }> {
    const protection = (await this.orca.host.call("secrets.protection")) as { status: string }
    if (protection.status !== "os-keyring") {
      this.orca.log("Logins are not saved: this machine offers no OS key store to Orca.")
      return { ok: false }
    }
    await this.parts.ready()
    const ok = await this.parts.registry.saveLogin(engine, username, password)
    this.orca.panels.post("engines.changed", { reason: "login" })
    return { ok }
  }

  private show(panel: string, visible: boolean): void {
    if (visible) {
      this.visible.add(panel)
    } else {
      this.visible.delete(panel)
    }
    this.parts.live.show(this.visible.size > 0)
  }

  private static isPulsePanel(panel: PanelCaller): boolean {
    return panel.surface === "panel" && panel.contributionId === PULSE_PANEL
  }
}
