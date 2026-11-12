import {
  BulkRuns,
  type LocalSources,
  type MigrationTarget,
  type PanelContext,
} from "@miragon/pulse-runtime-view/core"
import { MessageGuards, type PanelState } from "@miragon/pulse-runtime-view/protocol"
import {
  type Connection,
  type WriteAudit,
  PanelOrigins,
} from "@miragon/pulse-runtime-view/host-kit"
import type { OrcaWorkerApi } from "orca/worker"
import type { FrameAction, ViewHandle, ViewRequest, ViewSpec } from "../protocol.js"
import { CockpitView } from "./cockpit-view.js"
import type { EffectsHost, ServiceHost, ViewNavigation } from "./effects-host.js"
import type { EngineRegistry } from "./engine-registry.js"
import { OrcaPanelEffects } from "./orca-panel-effects.js"
import { PanelFactories } from "./panel-factories.js"
import type { OrcaLive } from "./orca-live.js"
import { SurfaceWatch } from "./surface-watch.js"
import { ViewHandles } from "./view-handles.js"

export interface ViewsDependencies {
  readonly orca: OrcaWorkerApi
  readonly registry: EngineRegistry
  readonly live: OrcaLive
  readonly audit: WriteAudit
  readonly sources: LocalSources
  readonly services: ServiceHost
  readonly openFile: (request: ViewRequest) => Promise<string>
  readonly closed: (frame: string) => void
}

interface Attached {
  readonly attached: boolean
  readonly problem?: string
}

export class CockpitViews {
  private readonly views = new Map<string, CockpitView>()
  private readonly frames = new Map<string, string>()
  private readonly requests = new Map<string, ViewRequest>()
  private readonly migrations = new Map<string, MigrationTarget>()
  private readonly origins = new PanelOrigins((key) => this.views.has(key))
  private readonly bulkRuns = new Map<string, BulkRuns>()
  readonly surfaces: SurfaceWatch

  constructor(private readonly deps: ViewsDependencies) {
    this.surfaces = new SurfaceWatch({
      changed: (frame, visible) => {
        this.attendFrame(frame, visible)
      },
      closed: (frame) => {
        this.detach(frame)
        deps.closed(frame)
      },
    })
    deps.registry.onDidChange(() => {
      this.rebindAll()
    })
    deps.live.onDidChange(() => {
      this.attendAll()
    })
  }

  async open(request: ViewRequest, origin?: string): Promise<string> {
    const key = ViewHandles.keyOf(request)
    this.requests.set(key, request)
    this.origins.remember(key, origin)
    return this.deps.openFile(request)
  }

  async openMigration(engine: string, target: MigrationTarget, origin: string): Promise<string> {
    const request: ViewRequest = { engine, view: "migration", bpmnProcessId: target.bpmnProcessId }
    this.migrations.set(ViewHandles.keyOf(request), target)
    return this.open(request, origin)
  }

  goBack(key: string): void {
    const origin = this.origins.of(key)
    const request = origin === undefined ? undefined : this.requests.get(origin)
    if (request !== undefined) {
      void this.deps.openFile(request)
    }
  }

  frameAction(key: string, action: FrameAction): void {
    this.views.get(key)?.frameAction(action)
  }

  async attach(frame: string, text: string): Promise<Attached> {
    const handle = ViewHandles.parse(text)
    if (handle === undefined) {
      return { attached: false, problem: "This file is not a Pulse view." }
    }
    const connection = this.deps.registry.byName(handle.engine)
    if (connection === undefined) {
      return {
        attached: false,
        problem: `Pulse has no engine named ${handle.engine}. Check your project file.`,
      }
    }
    const key = ViewHandles.keyOf(handle)
    this.detach(frame)
    const view = this.views.get(key) ?? (await this.created(key, handle, connection))
    if (typeof view === "string") {
      return { attached: false, problem: view }
    }
    view.attach(frame)
    this.frames.set(frame, key)
    view.attend(this.deps.live.of(true))
    return { attached: true }
  }

  async intent(
    frame: string,
    intent: unknown,
  ): Promise<{ known: boolean; actions: readonly FrameAction[] }> {
    const view = this.viewOf(frame)
    if (view === undefined) {
      return { known: false, actions: [] }
    }
    if (!MessageGuards.isWebviewIntent(intent)) {
      return { known: true, actions: [] }
    }
    if (intent.type === "activity") {
      this.deps.live.noteActivity()
      return { known: true, actions: [] }
    }
    return { known: true, actions: await view.intent(intent) }
  }

  focusOf(frame: string): string | undefined {
    const key = this.frames.get(frame)
    const spec = key === undefined ? undefined : this.requests.get(key)
    if (spec === undefined) {
      return undefined
    }
    return "bpmnProcessId" in spec
      ? `definition|${spec.engine}|${spec.bpmnProcessId}`
      : `engine|${spec.engine}`
  }

  dispose(): void {
    this.surfaces.dispose()
    for (const view of this.views.values()) {
      view.dispose()
    }
    this.views.clear()
    this.frames.clear()
  }

  nudgeLocal(): void {
    for (const view of this.views.values()) {
      view.nudgeLocal()
    }
  }

  private async created(
    key: string,
    handle: ViewHandle,
    connection: Connection,
  ): Promise<CockpitView | string> {
    const panel = await PanelFactories.of(handle, this.migrations.get(key))
    if (typeof panel === "string") {
      return panel
    }
    this.requests.set(key, handle)
    const view = new CockpitView(
      this.deps.orca,
      connection,
      { panel, context: (current, publish) => this.contextFor(current, key, publish) },
      () => this.backOf(key),
    )
    this.views.set(key, view)
    return view
  }

  private contextFor(
    connection: Connection,
    key: string,
    publish: (state: PanelState) => void,
  ): PanelContext {
    return {
      runtime: connection.runtime,
      engine: connection.badge,
      diagrams: connection.diagrams,
      definitions: connection.definitions,
      effects: new OrcaPanelEffects(connection, key, this.effectsHost(), this.deps.audit),
      publish,
      now: () => new Date(),
      wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      ...(connection.commands === undefined ? {} : { commands: connection.commands }),
      ...(connection.cli === undefined ? {} : { cli: connection.cli }),
      sources: this.deps.sources,
      live: this.deps.live.contextFor(connection),
      bulkRuns: this.bulkRunsOf(connection),
    }
  }

  private effectsHost(): EffectsHost {
    return { services: this.deps.services, navigation: this.navigation() }
  }

  private navigation(): ViewNavigation {
    return {
      open: (engine: string, spec: ViewSpec, origin: string) => {
        void this.open({ engine, ...spec }, origin).catch((error: unknown) => {
          this.deps.orca.log(`open ${spec.view} failed: ${String(error)}`)
        })
      },
      openMigration: (engine: string, target: MigrationTarget, origin: string) => {
        void this.openMigration(engine, target, origin)
      },
      goBack: (key: string) => {
        this.goBack(key)
      },
      frameAction: (key: string, action: FrameAction) => {
        this.frameAction(key, action)
      },
    }
  }

  private bulkRunsOf(connection: Connection): BulkRuns {
    const key = `${connection.target.endpoint}|${connection.target.name}`
    const known = this.bulkRuns.get(key) ?? new BulkRuns()
    this.bulkRuns.set(key, known)
    return known
  }

  private backOf(key: string) {
    const origin = this.origins.of(key)
    const view = origin === undefined ? undefined : this.views.get(origin)
    return view === undefined ? undefined : { label: view.label }
  }

  private viewOf(frame: string): CockpitView | undefined {
    const key = this.frames.get(frame)
    return key === undefined ? undefined : this.views.get(key)
  }

  private detach(frame: string): void {
    const key = this.frames.get(frame)
    const view = key === undefined ? undefined : this.views.get(key)
    this.frames.delete(frame)
    if (key === undefined || view === undefined) {
      return
    }
    view.detach(frame)
    if (view.isEmpty) {
      view.dispose()
      this.views.delete(key)
      this.origins.forget(key)
    }
  }

  private attendFrame(frame: string, visible: boolean): void {
    if (visible) {
      this.deps.live.noteActivity()
    }
    const key = this.frames.get(frame)
    if (key !== undefined) {
      this.attendView(key)
    }
  }

  private attendAll(): void {
    for (const key of this.views.keys()) {
      this.attendView(key)
    }
  }

  private attendView(key: string): void {
    const visible = [...this.frames].some(
      ([frame, shown]) => shown === key && this.surfaces.isVisible(frame),
    )
    this.views.get(key)?.attend(this.deps.live.of(visible))
  }

  private rebindAll(): void {
    for (const [key, view] of this.views) {
      const connection = this.deps.registry.byName(view.engineName)
      if (connection === undefined) {
        view.dispose()
        this.views.delete(key)
      } else {
        view.rebind(connection)
      }
    }
  }
}
