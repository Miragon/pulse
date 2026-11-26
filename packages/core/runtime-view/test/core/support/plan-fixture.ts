import type { ProcessRuntime } from "@miragon/pulse-engine-core"
import { MigrationPlanText, type PlanMapping } from "@miragon/pulse-migration-plan"
import { MigrationPlanPanel } from "../../../src/core/plans/migration-plan-panel.js"
import type { PlanSource } from "../../../src/core/plans/plan-context.js"
import type { MigrationPlanView, PanelState } from "../../../src/core/protocol/index.js"
import type { SourceLocation } from "../../../src/ports/index.js"
import { panelFixture, type FixtureOptions, type PanelFixture } from "./panel-fixture.js"

export const PLAN_FILE = "pulse-order-v1-to-v2.migration.json"

export const PLAN_LOCATION: SourceLocation = {
  uri: "file:///work/.pulse/migrations/pulse-order-v1-to-v2.migration.json",
  line: 1,
}

export const REVIEW = "Activity_ReviewOrder"
export const CHARGE = "Activity_ChargePayment"

export class FakePlanSource implements PlanSource {
  readonly fileName = PLAN_FILE
  readonly location = PLAN_LOCATION
  reads = 0
  failure: Error | undefined
  bytes: number | undefined
  refusesWrites = false
  readonly written: string[] = []

  constructor(public text: string) {}

  size(): Promise<number> {
    return this.failure === undefined
      ? Promise.resolve(this.bytes ?? this.text.length)
      : Promise.reject(this.failure)
  }

  read(): Promise<string> {
    this.reads += 1
    return Promise.resolve(this.text)
  }

  write(text: string): Promise<boolean> {
    if (this.refusesWrites) {
      return Promise.resolve(false)
    }
    this.written.push(text)
    this.text = text
    return Promise.resolve(true)
  }
}

export interface OpenedPlan {
  readonly fixture: PanelFixture
  readonly panel: MigrationPlanPanel
  readonly source: FakePlanSource
  view(): MigrationPlanView
}

export function same(...elementIds: readonly string[]): PlanMapping[] {
  return elementIds.map((elementId) => ({ sourceElementId: elementId, targetElementId: elementId }))
}

export function planText(mappings: readonly PlanMapping[], target = 2): string {
  return MigrationPlanText.of({
    bpmnProcessId: "pulse-order",
    source: { version: 1 },
    target: { version: target },
    mappings,
  })
}

export function planView(state: PanelState): MigrationPlanView {
  const view = state.status === "ready" ? state.view : undefined
  if (view?.kind !== "migrationPlan") {
    throw new Error(`expected a ready migration plan view, got ${state.status}`)
  }
  return view
}

export function planless(runtime: ProcessRuntime): ProcessRuntime {
  return new Proxy(runtime, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key)
      if (key === "proposeMigration" || key === "checkMigration") {
        return undefined
      }
      return typeof value === "function" ? (value.bind(target) as unknown) : value
    },
  })
}

export async function openPlan(
  text: string,
  adapt: (runtime: ProcessRuntime) => ProcessRuntime = (runtime) => runtime,
  options: FixtureOptions = { writable: true },
): Promise<OpenedPlan> {
  const fixture = panelFixture(adapt, options)
  const source = new FakePlanSource(text)
  const panel = MigrationPlanPanel.over(fixture.context, source)
  await panel.handle({ type: "ready" })
  return { fixture, panel, source, view: () => planView(fixture.lastState()) }
}
