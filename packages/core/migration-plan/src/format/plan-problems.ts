import type { MigrationPlanNote, MigrationPlanProblem } from "./plan-definition.js"

export class MigrationPlanProblems {
  static describe(problem: MigrationPlanProblem | MigrationPlanNote): string {
    throw new Error(`MigrationPlanProblems.describe has no body for ${problem.code}`)
  }
}
