import { LOCAL_TARGET, type EngineTarget } from "./engine-target.js"
import type { ParsedTargets } from "./targets-parser.js"
import type { TargetsProblem } from "./targets-problem.js"

export interface DiscoveredTargets {
  readonly targets: readonly EngineTarget[]
  readonly problems: readonly TargetsProblem[]
}

const NOTHING: ParsedTargets = { names: [], targets: [], problems: [] }

export class TargetMerge {
  static of(projects: readonly ParsedTargets[], own: ParsedTargets = NOTHING): DiscoveredTargets {
    const shared = TargetMerge.firstWins(projects.flatMap((project) => project.targets))
    const owned = new Set(own.names)
    const targets = [
      ...shared.flatMap((target) =>
        owned.has(target.name) ? own.targets.filter((mine) => mine.name === target.name) : [target],
      ),
      ...own.targets.filter((mine) => !shared.some((target) => target.name === mine.name)),
    ]
    const named = [...projects, own].some((file) => file.names.length > 0)
    return {
      targets: named ? targets : [LOCAL_TARGET],
      problems: [...projects.flatMap((project) => project.problems), ...own.problems],
    }
  }

  private static firstWins(targets: readonly EngineTarget[]): readonly EngineTarget[] {
    return targets.filter(
      (target, index) => targets.findIndex((known) => known.name === target.name) === index,
    )
  }
}
