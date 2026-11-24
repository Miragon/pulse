import { MigrationPlanProblems, type MigrationPlanProblem } from "@miragon/pulse-migration-plan"
import type { EngineBadge, Problem } from "../protocol/index.js"
import { Labels } from "../views/labels.js"

const WHOLE_FILE = "(file)"

export interface PlanPlace {
  readonly fileName: string
  readonly bpmnProcessId: string
  readonly engine: EngineBadge
}

export class PlanProblems {
  static unreadable(fileName: string): Problem {
    return {
      title: `Pulse can't read ${fileName}.`,
      detail: "Check that the file is there and that you may read it.",
      canEditConnection: false,
      file: fileName,
    }
  }

  static broken(fileName: string, problems: readonly MigrationPlanProblem[]): Problem {
    return {
      title: `Pulse can't preview ${fileName}.`,
      detail: PlanProblems.detailOf(problems),
      canEditConnection: false,
      file: fileName,
    }
  }

  static missing({ fileName, bpmnProcessId, engine }: PlanPlace, version: number): Problem {
    return {
      title: `${engine.name} has no v${version} of ${bpmnProcessId}.`,
      detail:
        "A plan names versions by their numbers, and each engine numbers its own deployments; open the plan on the engine it was written for, or write it again for this engine.",
      canEditConnection: false,
      file: fileName,
    }
  }

  static ambiguous(
    { fileName, bpmnProcessId, engine }: PlanPlace,
    version: number,
    count: number,
  ): Problem {
    return {
      title: `${engine.name} has v${version} of ${bpmnProcessId} ${Labels.plural(count, "time")}.`,
      detail:
        "Each tenant numbers its own versions, and a plan names no tenant, so Pulse can't tell which one it means.",
      canEditConnection: false,
      file: fileName,
    }
  }

  private static detailOf(problems: readonly MigrationPlanProblem[]): string {
    const [first] = problems
    if (first === undefined) {
      return "The file holds no plan Pulse can read; write it again with pulse plan-migration."
    }
    const more = problems.length - 1
    return [
      PlanProblems.sentenceOf(first),
      ...(more > 0 ? [`And ${Labels.plural(more, "more problem")}.`] : []),
    ].join(" ")
  }

  private static sentenceOf(problem: MigrationPlanProblem): string {
    const where = problem.path === WHOLE_FILE ? "The file" : problem.path
    return `${where} ${MigrationPlanProblems.describe(problem)}.`
  }
}
