import { vi } from "vitest"
import { FakeEngine, FakeWorld } from "../../src/contract/fake/index.js"
import { DiagramCache, type LocalSources } from "../../src/core/index.js"
import type { Connection } from "../../src/host/connections/connection.js"
import { LOCAL_TARGET } from "../../src/host/connections/engine-target.js"
import { WriteAudit } from "../../src/host/connections/write-audit.js"
import { CockpitViews } from "../../dev/orca/worker/cockpit-views.js"
import type { ServiceHost } from "../../dev/orca/worker/effects-host.js"
import type { EngineRegistry } from "../../dev/orca/worker/engine-registry.js"
import { OrcaLive } from "../../dev/orca/worker/orca-live.js"
import { ConnectionLive } from "../host/support/connection-live.js"
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
