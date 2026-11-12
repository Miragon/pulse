import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  InstanceId,
  type InstanceDetail,
  type WaitState,
} from "@miragon/pulse-engine-core"
import { FakeEngine, FakeWorld } from "@miragon/pulse-engine-core/testing"
import {
  BulkRuns,
  DiagramCache,
  EngineLane,
  type Panel,
  type PanelContext,
  type PanelEffects,
} from "@miragon/pulse-runtime-view/core"
import {
  type Connection,
  ConnectionBuilder,
  type EngineTarget,
  LOCAL_TARGET,
  WriteAudit,
} from "@miragon/pulse-runtime-view/host-kit"
import type { EngineCli } from "@miragon/pulse-runtime-view/ports"
import { describe, expect, test, vi } from "vitest"
import type * as vscode from "vscode"
import { CompositionRoot } from "../../src/host/composition-root.js"
import { VSCODE_WRITES_WORDING } from "../../src/host/connections/writes-wording.js"
import type { LiveWiring } from "../../src/host/live/live-wiring.js"
import { OpenPanel, type PanelNavigation } from "../../src/host/panels/open-panel.js"
import { ConnectionLive } from "./support/connection-live.js"

vi.mock("vscode", () => import("./support/vscode-fake.js"))

vi.mock("@miragon/modeler-shell/vscode/extension", () => ({
  connectThemeBridge: () => ({ dispose: () => undefined }),
}))

const NOTHING = { dispose: () => undefined }

const CLI: EngineCli = { triggerCommand: () => "pulse advance i-1 --activity-id Parcel" }

function connection(cli?: EngineCli): Connection {
  const runtime = new FakeEngine(FakeWorld.seed().state)
  return {
    target: LOCAL_TARGET,
    badge: { name: "local", environment: "local", host: "localhost:8080" },
    runtime,
    diagrams: new DiagramCache(runtime),
    ...ConnectionLive.of(runtime),
    ...(cli === undefined ? {} : { cli }),
  }
}

const PAID: WaitState = {
  kind: "message",
  messageName: "PaymentReceived",
  instanceId: InstanceId("i-1"),
  elementId: ElementId("Event_Paid"),
}

const BEHIND_A_GATEWAY: InstanceDetail = {
  instance: {
    id: InstanceId("i-1"),
    definition: {
      id: DefinitionId("order:1:a"),
      bpmnProcessId: BpmnProcessId("order"),
      version: 1,
    },
    state: "running",
    hasIncident: false,
  },
  path: [],
  waitStates: [PAID],
  incidents: [],
  calledInstances: [],
  variables: [],
  truncated: false,
}

function connectionTo(target: EngineTarget): Connection {
  return new ConnectionBuilder(
    CompositionRoot.create(),
    new WriteAudit({ info: () => undefined }),
    VSCODE_WRITES_WORDING,
  ).build(target, { kind: "none" }, "local", {
    writes: "localOnly",
    live: undefined,
    lane: new EngineLane(),
  })
}

function webviewPanel(): vscode.WebviewPanel {
  return {
    title: "Pulse",
    visible: false,
    webview: { postMessage: () => Promise.resolve(true), onDidReceiveMessage: () => NOTHING },
    onDidChangeViewState: () => NOTHING,
  } as unknown as vscode.WebviewPanel
}

const NAVIGATION: PanelNavigation = {
  effectsFor: () => ({}) as PanelEffects,
  backOf: () => undefined,
  sources: undefined,
  live: {
    attention: { onDidChange: () => NOTHING, of: () => "visible" },
    contextFor: () => ({}),
  } as unknown as LiveWiring,
  bulkRunsFor: () => new BulkRuns(),
}

function contextOf(given: Connection): PanelContext {
  const contexts: PanelContext[] = []
  const session = { attend: () => undefined, dispose: () => undefined } as unknown as Panel
  new OpenPanel(
    webviewPanel(),
    given,
    (context) => {
      contexts.push(context)
      return session
    },
    NAVIGATION,
  ).dispose()
  const [context] = contexts
  if (context === undefined) {
    throw new Error("no session was created")
  }
  return context
}

describe("a panel the extension opens", () => {
  test("hands its session the engine's CLI, which the move refusals name, and none without one", () => {
    expect(contextOf(connection(CLI)).cli).toBe(CLI)
    expect(contextOf(connection())).not.toHaveProperty("cli")
  })

  test.each([
    [
      "the default engine by its URL, reached without credentials",
      LOCAL_TARGET,
      "--url http://localhost:8080/engine-rest --auth none",
    ],
    [
      "an engine of the project file by its profile",
      { ...LOCAL_TARGET, name: "shop-dev", source: { kind: "file", path: "/shop/.pulse.json" } },
      "--profile shop-dev",
    ],
  ] as const)(
    "hands its session the CLI of the engine it shows, which names %s",
    (_, target: EngineTarget, options) => {
      const cli = contextOf(connectionTo(target)).cli

      expect(cli?.triggerCommand(BEHIND_A_GATEWAY, PAID)).toBe(
        `pulse advance i-1 --activity-id Event_Paid ${options}`,
      )
    },
  )
})
