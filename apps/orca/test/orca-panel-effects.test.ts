import { describe, expect, test, vi } from "vitest"
import {
  BpmnProcessId,
  DefinitionId,
  InstanceId,
  type InstanceSummary,
} from "@miragon/pulse-engine-core"
import type { MigrationTarget } from "@miragon/pulse-runtime-view/core"
import { type Connection, LOCAL_TARGET, WriteAudit } from "@miragon/pulse-runtime-view/host-kit"
import type { EffectsHost } from "../src/worker/effects-host.js"
import { OrcaPanelEffects } from "../src/worker/orca-panel-effects.js"

const KEY = "shop/order.pulse-view"
const WEB_UI = {
  name: "Cockpit",
  overviewUrl: () => "https://cockpit/",
  instanceUrl: (instance: { id: string }) => `https://cockpit/instance/${instance.id}`,
  definitionUrl: (definition: { id: string }) => `https://cockpit/definition/${definition.id}`,
}

class Harness {
  readonly lines: string[] = []
  readonly navigation = {
    open: vi.fn(),
    openMigration: vi.fn(),
    goBack: vi.fn(),
    frameAction: vi.fn(),
  }
  readonly services = {
    confirmation: { confirm: vi.fn(() => Promise.resolve(true)), confirmBulk: vi.fn() },
    pick: vi.fn(() => Promise.resolve("b")),
    notice: vi.fn(),
    showIncident: vi.fn(),
    openLocation: vi.fn(),
    editConnection: vi.fn(),
    askForLogin: vi.fn(),
    turnOnLiveUpdates: vi.fn(),
    noteWrite: vi.fn(),
  }
  readonly connection: Connection
  readonly effects: OrcaPanelEffects

  constructor(webUi: typeof WEB_UI | null = WEB_UI) {
    this.connection = {
      target: { ...LOCAL_TARGET, name: "shop" },
      badge: { name: "shop", environment: "local", host: "localhost:8080" },
      ...(webUi === null ? {} : { webUi }),
    } as unknown as Connection
    const host = { navigation: this.navigation, services: this.services } as unknown as EffectsHost
    this.effects = new OrcaPanelEffects(
      this.connection,
      KEY,
      host,
      new WriteAudit({ info: (line) => this.lines.push(line) }),
    )
  }
}

describe("the effects of a view in Orca", () => {
  test("open other views of the same engine with the view as their origin", () => {
    const { effects, navigation } = new Harness()
    const target = { bpmnProcessId: BpmnProcessId("order") } as unknown as MigrationTarget

    effects.openInstance(InstanceId("i-1"))
    effects.openDefinition(BpmnProcessId("order"), DefinitionId("order:2"))
    effects.openLatestDefinition(BpmnProcessId("order"))
    effects.openMigration(target)
    effects.goBack()

    expect(navigation.open.mock.calls).toEqual([
      ["shop", { view: "instance", instanceId: "i-1" }, KEY],
      ["shop", { view: "definition", bpmnProcessId: "order", definitionId: "order:2" }, KEY],
      ["shop", { view: "definition", bpmnProcessId: "order" }, KEY],
    ])
    expect(navigation.openMigration).toHaveBeenCalledWith("shop", target, KEY)
    expect(navigation.goBack).toHaveBeenCalledWith(KEY)
  })

  test("hand the engine's web app and copies back to the clicked frame", () => {
    const { effects, navigation } = new Harness()
    const instance = { id: "i-1", definition: { id: "order:2" } } as unknown as InstanceSummary

    effects.openWebUi({ kind: "engine" })
    effects.openWebUi({ kind: "instance", instance })
    effects.openWebUi({ kind: "definition", definition: instance.definition })
    effects.copyToClipboard("ORD-1", "Business key")

    expect(navigation.frameAction.mock.calls.map(([, action]) => action as unknown)).toEqual([
      { kind: "openExternal", url: "https://cockpit/" },
      { kind: "openExternal", url: "https://cockpit/instance/i-1" },
      { kind: "openExternal", url: "https://cockpit/definition/order:2" },
      { kind: "copy", text: "ORD-1", label: "Business key" },
    ])
  })

  test("open nothing without a web app", () => {
    const { effects, navigation } = new Harness(null)

    effects.openWebUi({ kind: "engine" })

    expect(navigation.frameAction).not.toHaveBeenCalled()
  })

  test("pick only an instance that was offered", async () => {
    const { effects, services } = new Harness()
    const choices = [{ instanceId: InstanceId("b"), label: "B", description: "" }]

    expect(await effects.pickInstance("Which?", choices)).toBe("b")
    services.pick.mockResolvedValueOnce("x")
    expect(await effects.pickInstance("Which?", choices)).toBeUndefined()
  })

  test("pass the services of the host through", async () => {
    const { effects, services, connection } = new Harness()
    const details = { kind: "stacktrace" as const, text: "boom", truncated: false }
    const location = { uri: "file:///order.bpmn" } as never

    effects.showIncidentDetails("Failed", details)
    effects.editConnection()
    effects.setCredentials()
    effects.openModel(location)
    effects.openSource(location)
    effects.turnOnLiveUpdates("test")
    await effects.confirmWrite({} as never)
    await effects.confirmBulk({} as never)

    expect(services.showIncident).toHaveBeenCalledWith("shop", "Failed", details)
    expect(services.editConnection).toHaveBeenCalled()
    expect(services.askForLogin).toHaveBeenCalledWith(connection)
    expect(services.openLocation).toHaveBeenCalledTimes(2)
    expect(services.turnOnLiveUpdates).toHaveBeenCalledWith("test")
    expect(services.confirmation.confirm).toHaveBeenCalledWith(connection, {})
    expect(services.confirmation.confirmBulk).toHaveBeenCalledWith(connection, {})
  })

  test("report problems and writes as notices in printable text", () => {
    const { effects, services } = new Harness()

    effects.reportProblem({ title: "Engine down.", detail: "Try\u0007 again." } as never)
    effects.reportWritten("Retried the incident.")

    expect(services.notice.mock.calls).toEqual([
      [{ tone: "danger", text: expect.not.stringContaining("\u0007") as unknown }],
      [{ tone: "success", text: "Retried the incident." }],
    ])
    expect(services.noteWrite).toHaveBeenCalled()
  })

  test("record the outcome of a bulk run in the write audit", () => {
    const harness = new Harness()

    harness.effects.reportBulkOutcome({
      action: "cancelInstances",
      operationId: "bulk-1",
      phase: "finished",
      total: 2,
      remaining: 0,
      failed: 0,
    })

    expect(harness.lines).toEqual([expect.stringContaining("cancelInstancesOutcome")])
  })
})
