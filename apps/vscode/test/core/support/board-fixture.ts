import {
  BpmnProcessId,
  DefinitionId,
  InstanceId,
  type DefinitionSummary,
  type InstanceSummary,
  type ProcessRuntime,
} from "../../../src/contract/index.js"
import { FakeEngine, FakeWorld, PatchedRuntime } from "../../../src/contract/fake/index.js"
import { vi, type Mock } from "vitest"
import type {
  BoardContext,
  BoardEngine,
  BoardNavigation,
} from "../../../src/core/boards/board-engine.js"
import { EngineLane } from "../../../src/core/refresh/engine-lane.js"
import { SharedDefinitions } from "../../../src/core/refresh/shared-definitions.js"
import type { BoardView, EngineBadge, PanelState } from "../../../src/core/protocol/index.js"

const NOW = new Date("2026-10-26T09:00:00Z")

export interface EngineSetup {
  readonly name: string
  readonly runtime?: ProcessRuntime
}

export interface BoardFixture {
  readonly context: BoardContext
  readonly states: PanelState[]
  readonly calls: Map<string, string[]>
  readonly navigation: { readonly [Name in keyof BoardNavigation]: Mock<BoardNavigation[Name]> }
  content: string | Error
  view(): BoardView
}

export function badgeOf(name: string): EngineBadge {
  return { name, environment: "test", host: `${name}.example` }
}

export function summary(
  bpmnProcessId: string,
  running: number,
  withIncident: number,
  name?: string,
): DefinitionSummary {
  return {
    latest: {
      id: DefinitionId(`${bpmnProcessId}:1`),
      bpmnProcessId: BpmnProcessId(bpmnProcessId),
      version: 1,
      ...(name === undefined ? {} : { name }),
    },
    running,
    withIncident,
  }
}

export function instance(id: string, bpmnProcessId: string, businessKey?: string): InstanceSummary {
  return {
    id: InstanceId(id),
    definition: {
      id: DefinitionId(`${bpmnProcessId}:2`),
      bpmnProcessId: BpmnProcessId(bpmnProcessId),
      version: 2,
      name: "Order fulfillment",
    },
    state: "running",
    hasIncident: false,
    startedAt: "2026-10-26T08:00:00.000Z" as InstanceSummary["startedAt"] & string,
    ...(businessKey === undefined ? {} : { businessKey }),
  }
}

export function stubbed(patch: Partial<ProcessRuntime>): ProcessRuntime {
  const { state } = FakeWorld.seed()
  return new PatchedRuntime(new FakeEngine(state), patch)
}

function counted(name: string, runtime: ProcessRuntime, calls: Map<string, string[]>) {
  const log: string[] = []
  calls.set(name, log)
  return new Proxy(runtime, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver)
      if (typeof value !== "function") {
        return value
      }
      return (...args: unknown[]) => {
        log.push(String(property))
        return (value as (...parameters: unknown[]) => unknown).apply(target, args)
      }
    },
  })
}

export function boardFixture(content: unknown, engines: readonly EngineSetup[]): BoardFixture {
  const states: PanelState[] = []
  const calls = new Map<string, string[]>()
  const configured = new Map<string, BoardEngine>()
  for (const setup of engines) {
    if (setup.runtime !== undefined) {
      const runtime = counted(setup.name, setup.runtime, calls)
      configured.set(setup.name, {
        name: setup.name,
        configured: true,
        badge: badgeOf(setup.name),
        runtime,
        definitions: new SharedDefinitions(runtime, new EngineLane()),
      })
    }
  }
  const navigation = {
    openInstance: vi.fn<BoardNavigation["openInstance"]>(),
    openDefinition: vi.fn<BoardNavigation["openDefinition"]>(),
    openEngine: vi.fn<BoardNavigation["openEngine"]>(),
    openFile: vi.fn<BoardNavigation["openFile"]>(),
    editEngines: vi.fn<BoardNavigation["editEngines"]>(),
    setCredentials: vi.fn<BoardNavigation["setCredentials"]>(),
  }
  const fixture: BoardFixture = {
    content: typeof content === "string" ? content : JSON.stringify(content),
    states,
    calls,
    navigation,
    context: {
      fileName: "shop.board.json",
      read: () =>
        fixture.content instanceof Error
          ? Promise.reject(fixture.content)
          : Promise.resolve(fixture.content),
      engines: (names) => names.map((name) => configured.get(name) ?? { name, configured: false }),
      navigation,
      publish: (state) => states.push(state),
      now: () => NOW,
    },
    view: () => {
      const last = states.at(-1)
      if (last?.status !== "ready" || last.view.kind !== "board") {
        throw new Error("expected a ready board")
      }
      return last.view
    },
  }
  return fixture
}
