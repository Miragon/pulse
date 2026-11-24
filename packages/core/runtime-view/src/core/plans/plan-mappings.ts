import { ElementId, type ElementMapping } from "@miragon/pulse-engine-core"
import type { ElementPair, MappingRefusal, MigrationElements } from "../views/migration-elements.js"

export interface RefusedMapping {
  readonly mapping: ElementPair
  readonly refusal: MappingRefusal
}

export interface SplitMappings {
  readonly accepted: readonly ElementMapping[]
  readonly refused: readonly RefusedMapping[]
}

export class PlanMappings {
  static split(elements: MigrationElements, mappings: readonly ElementPair[]): SplitMappings {
    const accepted: ElementMapping[] = []
    const refused: RefusedMapping[] = []
    for (const mapping of mappings) {
      const refusal = elements.refusalOf(mapping)
      if (refusal === undefined) {
        accepted.push({
          sourceElementId: ElementId(mapping.sourceElementId),
          targetElementId: ElementId(mapping.targetElementId),
        })
      } else {
        refused.push({ mapping, refusal })
      }
    }
    return { accepted, refused }
  }
}
