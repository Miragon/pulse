import { FailingRuntime, type ProcessRuntime } from "../../src/index.js"
import {
  ConformanceKit,
  FakeEngine,
  FakeWorld,
  PatchedRuntime,
  type CaseName,
  type ConformanceHarness,
} from "../../src/testing/index.js"

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

  static without(methods: readonly (keyof ProcessRuntime)[]): ConformanceHarness {
    const harness = SabotagedRuntime.conforming()
    return { ...harness, runtime: SabotagedRuntime.stripped(harness.runtime, methods) }
  }

  static stripped(
    runtime: ProcessRuntime,
    methods: readonly (keyof ProcessRuntime)[],
  ): ProcessRuntime {
    return new Proxy(runtime, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key)
        if (methods.some((method) => method === key)) {
          return undefined
        }
        return typeof value === "function" ? (value.bind(target) as unknown) : value
      },
    })
  }

  static async failingCases(harness: ConformanceHarness): Promise<CaseName[]> {
    const failing: CaseName[] = []
    for (const conformanceCase of ConformanceKit.runtimeLaws()) {
      await conformanceCase.run(harness).catch(() => failing.push(conformanceCase.name as CaseName))
    }
    return failing.sort()
  }
}
