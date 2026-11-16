import { BoardProblems, type BoardProblem } from "@miragon/pulse-board"
import type { WordedProblem } from "../protocol/index.js"

export class ProblemTexts {
  static of(problems: readonly BoardProblem[]): readonly WordedProblem[] {
    return problems.map((problem) => ({ ...problem, reason: BoardProblems.describe(problem) }))
  }
}
