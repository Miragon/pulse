import { BoardProblems, type BoardProblem as FormatProblem } from "@miragon/pulse-board"
import type { BoardProblem } from "../protocol/index.js"

export class ProblemTexts {
  static of(problems: readonly FormatProblem[]): readonly BoardProblem[] {
    return problems.map((problem) => ({
      path: problem.path,
      reason: BoardProblems.describe(problem),
    }))
  }
}
