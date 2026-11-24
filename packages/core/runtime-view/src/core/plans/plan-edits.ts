import {
  MigrationPlanText,
  type MigrationPlanDefinition,
  type PlanMapping,
} from "@miragon/pulse-migration-plan"
import { MigrationElements } from "../views/migration-elements.js"
import { MigrationRows } from "../views/migration-rows.js"
import type { PlanState } from "./plan-view-builder.js"

export class PlanEdits {
  static planOf(state: PlanState, mappings = PlanEdits.mappingsOf(state)): MigrationPlanDefinition {
    return {
      bpmnProcessId: state.source.bpmnProcessId,
      source: { version: state.source.version },
      target: { version: state.target.version },
      mappings,
    }
  }

  static mappingsOf(state: PlanState): PlanMapping[] {
    return [
      ...state.mappings.map(({ sourceElementId, targetElementId }) => ({
        sourceElementId: String(sourceElementId),
        targetElementId: String(targetElementId),
      })),
      ...state.refused.map((entry) => entry.mapping),
    ]
  }

  static mapped(
    state: PlanState,
    sourceElementId: string,
    targetElementId: string,
  ): MigrationPlanDefinition | undefined {
    const mapping = { sourceElementId, targetElementId }
    const current = PlanEdits.mappingsOf(state)
    if (
      !PlanEdits.shows(state, sourceElementId) ||
      !new MigrationElements(state.sourceXml, state.targetXml).maps(mapping) ||
      current.some((pair) => PlanEdits.same(pair, mapping))
    ) {
      return undefined
    }
    return PlanEdits.planOf(state, [...PlanEdits.without(current, sourceElementId), mapping])
  }

  static unmapped(state: PlanState, sourceElementId: string): MigrationPlanDefinition | undefined {
    const current = PlanEdits.mappingsOf(state)
    const kept = PlanEdits.without(current, sourceElementId)
    return kept.length === current.length ? undefined : PlanEdits.planOf(state, kept)
  }

  static textOf(plan: MigrationPlanDefinition, schema: string | undefined): string | undefined {
    try {
      return MigrationPlanText.of(plan, schema === undefined ? {} : { schema })
    } catch {
      return undefined
    }
  }

  static keyOf(mappings: readonly PlanMapping[]): string {
    return mappings
      .map((pair) => `${pair.sourceElementId}>${pair.targetElementId}`)
      .sort()
      .join(",")
  }

  private static shows(state: PlanState, sourceElementId: string): boolean {
    return (
      new MigrationRows(state).rows().some((row) => row.sourceElementId === sourceElementId) ||
      state.refused.some((entry) => entry.mapping.sourceElementId === sourceElementId)
    )
  }

  private static same(left: PlanMapping, right: PlanMapping): boolean {
    return (
      left.sourceElementId === right.sourceElementId &&
      left.targetElementId === right.targetElementId
    )
  }

  private static without(mappings: readonly PlanMapping[], sourceElementId: string): PlanMapping[] {
    return mappings.filter((pair) => pair.sourceElementId !== sourceElementId)
  }
}
