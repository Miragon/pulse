import { vi } from "vitest"
import {
  ConformanceKit,
  FakeEngine,
  FakeWorld,
  type CommandCaseName,
  type CommandHarness,
} from "../../src/testing/index.js"

const WORKS_OFF_WITHIN_ON_A_MOCKED_CLOCK = {
  withinMs: 2_000,
  wait: (ms: number) => {
    vi.setSystemTime(Date.now() + ms)
    return Promise.resolve()
  },
}

export class CommandHarnesses {
  static conforming(): CommandHarness {
    const { state, world } = FakeWorld.seedForCommands()
    const engine = new FakeEngine(state)
    return {
      runtime: engine,
      commands: engine,
      world,
      asyncWork: WORKS_OFF_WITHIN_ON_A_MOCKED_CLOCK,
    }
  }

  static async failingCases(harness: CommandHarness): Promise<CommandCaseName[]> {
    const failing: CommandCaseName[] = []
    for (const conformanceCase of ConformanceKit.commandLaws()) {
      await conformanceCase
        .run(harness)
        .catch(() => failing.push(conformanceCase.name as CommandCaseName))
    }
    return failing.sort()
  }
}
