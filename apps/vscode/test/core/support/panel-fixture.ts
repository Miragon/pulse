import type {
  IncidentDetails,
  ProcessCommands,
  ProcessRuntime,
} from "../../../src/contract/index.js"
import type { SeededWorld } from "../../../src/contract/conformance/index.js"
import { FakeEngine, FakeWorld } from "../../../src/contract/fake/index.js"
import { vi, type Mock } from "vitest"
import { DiagramCache } from "../../../src/core/diagrams/diagram-cache.js"
import { BulkRuns } from "../../../src/core/panels/bulk-runs.js"
import { EngineLane } from "../../../src/core/refresh/engine-lane.js"
import type { LiveContext } from "../../../src/core/refresh/live-context.js"
import type { LiveSetting } from "../../../src/core/refresh/live-switch.js"
import { LiveSwitch } from "../../../src/core/refresh/live-switch.js"
import { SharedDefinitions } from "../../../src/core/refresh/shared-definitions.js"
import { ManualScheduler } from "./manual-scheduler.js"
import type {
  LocalSources,
  PanelContext,
  PanelEffects,
} from "../../../src/core/panels/panel-context.js"
import type { EngineBadge, PanelState } from "../../../src/core/protocol/index.js"

const ENGINE: EngineBadge = { name: "local", environment: "local", host: "localhost" }
const NOW = new Date("2026-10-21T09:00:00Z")

interface CountingRuntime {
  readonly runtime: ProcessRuntime
  readonly calls: string[]
}

const RUNTIME_METHODS = [
  "describeEngine",
  "listDefinitions",
  "listVersions",
  "getDiagramXml",
  "getElementStatistics",
  "getCalledProcesses",
  "searchInstances",
  "countInstances",
  "listVariableNames",
  "getInstanceDetail",
  "searchIncidents",
  "getIncidentDetails",
  "getBulkOperation",
  "getBulkFailures",
  "proposeMigration",
  "checkMigration",
] as const satisfies readonly (keyof ProcessRuntime)[]

function counting(runtime: ProcessRuntime): CountingRuntime {
  const calls: string[] = []
  const counted = Object.fromEntries(
    RUNTIME_METHODS.map((name) => [
      name,
      (...args: unknown[]) => {
        calls.push(name)
        return (runtime[name] as (...parameters: unknown[]) => unknown).apply(runtime, args)
      },
    ]),
  ) as unknown as ProcessRuntime
  return { runtime: counted, calls }
}

export interface PanelFixture {
  readonly context: PanelContext
  readonly calls: string[]
  readonly states: PanelState[]
  readonly effects: { readonly [Name in keyof PanelEffects]: Mock<PanelEffects[Name]> }
  readonly world: SeededWorld
  readonly scheduler: ManualScheduler
  readonly log: string[]
  lastState(): PanelState
}

export interface FixtureOptions {
  readonly writable?: boolean
  readonly engine?: EngineBadge
  readonly adaptCommands?: (commands: ProcessCommands) => ProcessCommands
  readonly sources?: LocalSources
  readonly live?: LiveSetting
  readonly now?: () => Date
}

export function panelFixture(
  adapt: (runtime: ProcessRuntime) => ProcessRuntime = (r) => r,
  options: FixtureOptions = {},
): PanelFixture {
  const { state, world } = FakeWorld.seed()
  const engine = new FakeEngine(state)
  const { runtime, calls } = counting(adapt(engine))
  const commands = (options.adaptCommands ?? ((given) => given))(engine)
  const states: PanelState[] = []
  const effects = {
    openInstance: vi.fn<PanelEffects["openInstance"]>(),
    openDefinition: vi.fn<PanelEffects["openDefinition"]>(),
    openLatestDefinition: vi.fn<PanelEffects["openLatestDefinition"]>(),
    openMigration: vi.fn<PanelEffects["openMigration"]>(),
    pickInstance: vi.fn<PanelEffects["pickInstance"]>(() => Promise.resolve(undefined)),
    openWebUi: vi.fn<PanelEffects["openWebUi"]>(),
    showIncidentDetails: vi.fn<(title: string, details: IncidentDetails) => void>(),
    copyToClipboard: vi.fn<PanelEffects["copyToClipboard"]>(),
    editConnection: vi.fn<PanelEffects["editConnection"]>(),
    setCredentials: vi.fn<PanelEffects["setCredentials"]>(),
    reportProblem: vi.fn<PanelEffects["reportProblem"]>(),
    confirmWrite: vi.fn<PanelEffects["confirmWrite"]>(() => Promise.resolve(true)),
    confirmBulk: vi.fn<PanelEffects["confirmBulk"]>(() => Promise.resolve({})),
    reportBulkOutcome: vi.fn<PanelEffects["reportBulkOutcome"]>(),
    reportWritten: vi.fn<PanelEffects["reportWritten"]>(),
    goBack: vi.fn<PanelEffects["goBack"]>(),
    openModel: vi.fn<PanelEffects["openModel"]>(),
    openSource: vi.fn<PanelEffects["openSource"]>(),
    turnOnLiveUpdates: vi.fn<PanelEffects["turnOnLiveUpdates"]>(),
  }
  const scheduler = new ManualScheduler(NOW.getTime())
  const now = options.now ?? (() => scheduler.now())
  const log: string[] = []
  const lane = new EngineLane()
  const live: LiveContext | undefined =
    options.live === undefined
      ? undefined
      : {
          switch: new LiveSwitch(options.live),
          scheduler,
          lane,
          random: () => 0.5,
          log: (line) => log.push(line),
        }
  const context: PanelContext = {
    runtime,
    engine: options.engine ?? ENGINE,
    diagrams: new DiagramCache(runtime),
    definitions: new SharedDefinitions(runtime, lane, () => now().getTime()),
    effects,
    publish: (published) => states.push(published),
    now,
    wait: vi.fn(() => Promise.resolve()),
    ...(options.writable === true ? { commands } : {}),
    ...(options.sources === undefined ? {} : { sources: options.sources }),
    ...(live === undefined ? {} : { live }),
    bulkRuns: new BulkRuns(),
  }
  return {
    context,
    calls,
    states,
    effects,
    world,
    scheduler,
    log,
    lastState: () => {
      const last = states.at(-1)
      if (last === undefined) {
        throw new Error("nothing was published")
      }
      return last
    },
  }
}
