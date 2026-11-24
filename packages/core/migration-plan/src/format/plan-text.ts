import type { MigrationPlanDefinition, PlanMapping } from "./plan-definition.js"
import { MigrationPlanParser } from "./plan-parser.js"
import { MigrationPlanProblems } from "./plan-problems.js"
import { MigrationPlanVocabulary } from "./plan-vocabulary.js"

export class MigrationPlanText {
  static of(plan: MigrationPlanDefinition, options: { readonly schema?: string } = {}): string {
    const document = {
      ...(options.schema === undefined ? {} : { $schema: options.schema }),
      ...MigrationPlanText.documentOf(plan),
    }
    const text = `${JSON.stringify(document, undefined, 2)}\n`
    const parsed = MigrationPlanParser.parse(text)
    if ("problems" in parsed) {
      const problems = parsed.problems.map(
        (problem) => `${problem.path} ${MigrationPlanProblems.describe(problem)}`,
      )
      throw new Error(`Pulse writes no plan it refuses to read: ${problems.join("; ")}`)
    }
    return text
  }

  private static documentOf(plan: MigrationPlanDefinition): object {
    return {
      schemaVersion: MigrationPlanVocabulary.SCHEMA_VERSION,
      bpmnProcessId: plan.bpmnProcessId,
      source: { version: plan.source.version },
      target: { version: plan.target.version },
      mappings: [...plan.mappings]
        .sort((left, right) => MigrationPlanText.order(left, right))
        .map(({ sourceElementId, targetElementId }) => ({ sourceElementId, targetElementId })),
    }
  }

  private static order(left: PlanMapping, right: PlanMapping): number {
    return (
      Number(left.sourceElementId > right.sourceElementId) -
      Number(left.sourceElementId < right.sourceElementId)
    )
  }
}
