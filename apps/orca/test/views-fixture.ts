import { vi } from "vitest"
import { FakeEngine, FakeWorld } from "@miragon/pulse-engine-core/testing"
import { DiagramCache, type LocalSources } from "@miragon/pulse-runtime-view/core"
import { type Connection, LOCAL_TARGET, WriteAudit } from "@miragon/pulse-runtime-view/host-kit"
import { CockpitViews } from "../src/worker/cockpit-views.js"
import type { ServiceHost } from "../src/worker/effects-host.js"
import type { EngineRegistry } from "../src/worker/engine-registry.js"
import { OrcaLive } from "../src/worker/orca-live.js"
import { ConnectionLive } from "./connection-live.js"
import { FakeOrca } from "./fake-orca.js"

export class ViewsFixture {
  readonly orca = new FakeOrca()
  readonly opened: unknown[] = []
  readonly closed: string[] = []
  readonly engines = new Map<string, Connection>()
  readonly live = new OrcaLive(() => undefined)
  readonly connection: Connection
  private readonly changes: (() => void)[] = []
  readonly views: CockpitViews
  openFails = false

  constructor(sources = {} as LocalSources) {
    const runtime = new FakeEngine(FakeWorld.seed().state)
    this.connection = {
      target: LOCAL_TARGET,
      badge: { name: "local", environment: "local", host: "localhost:8080", webUi: "Cockpit" },
      runtime,
      diagrams: new DiagramCache(runtime),
      webUi: { name: "Cockpit", overviewUrl: () => "http://localhost:8080/cockpit" },
      ...ConnectionLive.of(runtime),
    } as unknown as Connection
    this.engines.set("local", this.connection)
    const registry = {
      byName: (name: string) => this.engines.get(name),
      onDidChange: (listener: () => void) => {
        this.changes.push(listener)
        return () => undefined
      },
    } as unknown as EngineRegistry
    this.views = new CockpitViews({
      orca: this.orca.api(),
      registry,
      live: this.live,
      audit: new WriteAudit({ info: () => undefined }),
      sources,
      services: { notice: vi.fn() } as unknown as ServiceHost,
      openFile: (request) => {
        this.opened.push(request)
        return this.openFails
          ? Promise.reject(new Error("no workspace"))
          : Promise.resolve("/views/file.pulse-view")
      },
      closed: (frame) => {
        this.closed.push(frame)
      },
    })
  }

  changeEngines(): void {
    for (const listener of this.changes) {
      listener()
    }
  }

  statesFor(frame: string): unknown[] {
    return this.orca.posted
      .filter((post) => post.event === "cockpit.state" && post.panel === frame)
      .map((post) => post.payload)
  }
}
