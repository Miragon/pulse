import { FailingRuntime, type ProcessRuntime } from "../../../src/contract/index.js"
import {
  ConformanceKit,
  type CaseName,
  type ConformanceHarness,
} from "../../../src/contract/conformance/index.js"
import { FakeEngine, FakeWorld, PatchedRuntime } from "../../../src/contract/fake/index.js"

export type Sabotage = (
  runtime: ProcessRuntime,
  harness: ConformanceHarness,
) => Partial<ProcessRuntime>

export class SabotagedRuntime {
  static conforming(): ConformanceHarness {
    const { state, world } = FakeWorld.seed()
    return {
      runtime: new FakeEngine(state),
      unreachableRuntime: FailingRuntime.unreachable("http://unreachable.invalid"),
      world,
    }
  }

  static with(sabotage: Sabotage): ConformanceHarness {
    const harness = SabotagedRuntime.conforming()
    const broken = new PatchedRuntime(harness.runtime, sabotage(harness.runtime, harness))
    return { ...harness, runtime: broken }
  }

  static async failingCases(harness: ConformanceHarness): Promise<CaseName[]> {
    const failing: CaseName[] = []
    for (const conformanceCase of ConformanceKit.runtimeLaws()) {
      await conformanceCase.run(harness).catch(() => failing.push(conformanceCase.name as CaseName))
    }
    return failing.sort()
  }
}
