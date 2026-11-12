import {
  ConformanceKit,
  FakeEngine,
  FakeWorld,
  type CommandCaseName,
  type CommandHarness,
} from "../../src/testing/index.js"

const WORKS_OFF_WITHIN = { withinMs: 2_000, wait: () => Promise.resolve() }

export class CommandHarnesses {
  static conforming(): CommandHarness {
    const { state, world } = FakeWorld.seedForCommands()
    const engine = new FakeEngine(state)
    return { runtime: engine, commands: engine, world, asyncWork: WORKS_OFF_WITHIN }
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
