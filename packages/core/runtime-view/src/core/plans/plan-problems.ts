import { MigrationPlanProblems, type MigrationPlanProblem } from "@miragon/pulse-migration-plan"
import type { EngineBadge, Problem } from "../protocol/index.js"
import { Labels } from "../views/labels.js"

const WHOLE_FILE = "(file)"

export class PlanProblems {
  static unreadable(fileName: string): Problem {
    return {
      title: `Pulse can't read ${fileName}.`,
      detail: "Check that the file is there and that you may read it.",
      canEditConnection: false,
    }
  }

  static broken(fileName: string, problems: readonly MigrationPlanProblem[]): Problem {
    const sentences = problems.slice(0, 1).map((problem) => PlanProblems.sentenceOf(problem))
    const more = problems.length - sentences.length
    return {
      title: `Pulse can't preview ${fileName}.`,
      detail: [
        ...sentences,
        ...(more > 0 ? [`And ${Labels.plural(more, "more problem")}.`] : []),
      ].join(" "),
      canEditConnection: false,
    }
  }

  static missing(bpmnProcessId: string, version: number, engine: EngineBadge): Problem {
    return {
      title: `${engine.name} has no v${version} of ${bpmnProcessId}.`,
      detail:
        "A plan names versions by their numbers, and each engine numbers its own deployments; open the plan on the engine it was written for, or write it again for this engine.",
      canEditConnection: false,
    }
  }

  static ambiguous(
    bpmnProcessId: string,
    version: number,
    count: number,
    engine: EngineBadge,
  ): Problem {
    return {
      title: `${engine.name} has v${version} of ${bpmnProcessId} ${Labels.plural(count, "time")}.`,
      detail:
        "Each tenant numbers its own versions, and a plan names no tenant, so Pulse can't tell which one it means.",
      canEditConnection: false,
    }
  }

  private static sentenceOf(problem: MigrationPlanProblem): string {
    const where = problem.path === WHOLE_FILE ? "The file" : problem.path
    return `${where} ${MigrationPlanProblems.describe(problem)}.`
  }
}
