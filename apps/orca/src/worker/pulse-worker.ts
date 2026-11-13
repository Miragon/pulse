import { CompositionRoot } from "./composition-root.js"
import { WriteAudit } from "@miragon/pulse-runtime-view/host-kit"
import type { OrcaWorkerApi } from "orca/worker"
import type { ViewRequest } from "../protocol.js"
import { BoardViews } from "./board-views.js"
import { CockpitViews } from "./cockpit-views.js"
import { EditorRequests } from "./editor-requests.js"
import { EngineRegistry } from "./engine-registry.js"
import { EnginesLive } from "./engines-live.js"
import { LocalFiles } from "./local-files.js"
import { OrcaLive } from "./orca-live.js"
import { OrcaSettings } from "./orca-settings.js"
import { OrcaWorkspaceFiles } from "./orca-workspace-files.js"
import { OrcaWorkspaces } from "./orca-workspaces.js"
import { PanelRequests } from "./panel-requests.js"
import { Prompts } from "./prompts.js"
import { StatusBar } from "./status-bar.js"
import { ViewHandles } from "./view-handles.js"
import { WorkerServices } from "./worker-services.js"
import { WorkerTriggers } from "./worker-triggers.js"
import { WriteConfirmation } from "./write-confirmation.js"

export class PulseWorker {
  private loaded: Promise<void> | undefined
  private promptCount = 0
  private readonly stops: (() => void)[] = []
  private readonly workspaces: OrcaWorkspaces
  private readonly registry: EngineRegistry
  private readonly live: OrcaLive
  private readonly statusBar: StatusBar
  private readonly services: WorkerServices
  private readonly prompts: Prompts
  private readonly views: CockpitViews
  private readonly boards: BoardViews
  private readonly enginesLive: EnginesLive
  private readonly settings: OrcaSettings

  constructor(private readonly orca: OrcaWorkerApi) {
    const audit = new WriteAudit({
      info: (message) => {
        orca.log(message)
      },
    })
    this.settings = new OrcaSettings(orca)
    this.workspaces = new OrcaWorkspaces(orca)
    this.registry = new EngineRegistry(orca, this.settings, this.workspaces, audit)
    this.live = new OrcaLive((line) => {
      orca.log(line)
    })
    this.statusBar = new StatusBar(orca, this.registry)
    this.prompts = new Prompts((count) => {
      this.promptsChanged(count)
    })
    const confirmation = new WriteConfirmation(this.prompts, audit, () =>
      this.registry.environmentSettings(),
    )
    this.services = new WorkerServices(orca, this.registry, this.workspaces, {
      settings: this.settings,
      prompts: this.prompts,
      confirmation,
    })
    this.boards = new BoardViews(orca, this.registry, {
      open: (engine, spec) => {
        this.openView({ engine, ...spec })
      },
      editEngines: () => {
        this.services.editConnection()
      },
      askForLogin: (engine) => {
        const connection = this.registry.byName(engine)
        if (connection !== undefined) {
          this.services.askForLogin(connection)
        }
      },
    })
    this.views = new CockpitViews({
      orca,
      registry: this.registry,
      live: this.live,
      audit,
      sources: CompositionRoot.localSources(new OrcaWorkspaceFiles(() => this.services.roots())),
      services: this.services,
      openFile: (request) => this.writeAndOpen(request),
      closed: (frame) => {
        this.boards.closed(frame)
      },
    })
    this.enginesLive = new EnginesLive(this.registry, this.live, () => {
      orca.panels.post("engines.changed", { reason: "refresh" })
    })
  }

  start(): void {
    this.registry.onDidChange(() => {
      this.orca.panels.post("engines.changed", { reason: "reload" })
      void this.services.learnRoots()
    })
    this.registry.onDidWrite(() => {
      this.orca.panels.post("engines.changed", { reason: "write" })
    })
    const ready = () => this.ready()
    const panelRequests = new PanelRequests(this.orca, {
      registry: this.registry,
      settings: this.settings,
      prompts: this.prompts,
      views: this.views,
      services: this.services,
      files: new LocalFiles(() => this.services.roots()),
      live: this.enginesLive,
      workspaces: this.workspaces,
      ready,
    })
    panelRequests.register()
    new EditorRequests(this.orca, this.views, this.boards, ready).register()
    const triggers = new WorkerTriggers(this.orca, {
      registry: this.registry,
      workspaces: this.workspaces,
      services: this.services,
      nudgeLocal: () => {
        this.views.nudgeLocal()
        this.enginesLive.nudgeLocal()
      },
      openView: (request) => {
        this.openView(request)
      },
      ready,
    })
    triggers.register()
    this.stops.push(
      () => {
        triggers.dispose()
      },
      () => {
        panelRequests.dispose()
      },
    )
    void ready()
  }

  stop(): void {
    for (const stop of this.stops) {
      stop()
    }
    this.views.dispose()
    this.boards.dispose()
    this.enginesLive.dispose()
    this.prompts.dispose()
    this.live.dispose()
  }

  private ready(): Promise<void> {
    this.loaded ??= this.registry.reload().then(() => this.statusBar.render())
    return this.loaded
  }

  private openView(request: ViewRequest): void {
    void this.views.open(request).catch((error: unknown) => {
      this.orca.log(`open ${request.view} failed: ${String(error)}`)
    })
  }

  private async writeAndOpen(request: ViewRequest): Promise<string> {
    const file = await ViewHandles.write(await this.services.root(), request)
    await this.workspaces.openFile(file)
    return file
  }

  private promptsChanged(count: number): void {
    this.orca.panels.post("prompts.changed", { count })
    this.statusBar.prompts(count)
    const grew = count > this.promptCount
    this.promptCount = count
    if (grew) {
      void this.orca.host
        .call("notifications.show", {
          title: "Pulse waits for your answer",
          body: "Confirm or cancel the write in the Pulse panel.",
        })
        .catch(() => undefined)
    }
  }
}
