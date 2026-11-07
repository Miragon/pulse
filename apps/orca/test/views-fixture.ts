import { vi } from "vitest"
import { FakeEngine, FakeWorld } from "@miragon/pulse-runtime-view/contract/fake"
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
  readonly connection: Connection
  readonly views: CockpitViews

  constructor() {
    const runtime = new FakeEngine(FakeWorld.seed().state)
    this.connection = {
      target: LOCAL_TARGET,
      badge: { name: "local", environment: "local", host: "localhost:8080", webUi: "Cockpit" },
      runtime,
      diagrams: new DiagramCache(runtime),
      webUi: { name: "Cockpit", overviewUrl: () => "http://localhost:8080/cockpit" },
      ...ConnectionLive.of(runtime),
    } as unknown as Connection
    const registry = {
      byName: (name: string) => (name === "local" ? this.connection : undefined),
      onDidChange: () => () => undefined,
    } as unknown as EngineRegistry
    this.views = new CockpitViews({
      orca: this.orca.api(),
      registry,
      live: new OrcaLive(() => undefined),
      audit: new WriteAudit({ info: () => undefined }),
      sources: {} as LocalSources,
      services: { notice: vi.fn() } as unknown as ServiceHost,
      openFile: (request) => {
        this.opened.push(request)
        return Promise.resolve("/views/file.pulse-view")
      },
      closed: (frame) => {
        this.closed.push(frame)
      },
    })
  }

  statesFor(frame: string): unknown[] {
    return this.orca.posted
      .filter((post) => post.event === "cockpit.state" && post.panel === frame)
      .map((post) => post.payload)
  }
}
