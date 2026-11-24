import { ElementNames } from "../bpmn/element-names.js"
import { FlowNodes } from "../bpmn/flow-nodes.js"
import type { MappingCandidate } from "../protocol/index.js"

const MAPPABLE_KINDS: ReadonlySet<string> = new Set([
  "task",
  "userTask",
  "serviceTask",
  "scriptTask",
  "sendTask",
  "receiveTask",
  "manualTask",
  "businessRuleTask",
  "callActivity",
  "subProcess",
  "transaction",
  "intermediateCatchEvent",
  "boundaryEvent",
  "eventBasedGateway",
])
const SCOPE_MARK = "#"

export interface ElementPair {
  readonly sourceElementId: string
  readonly targetElementId: string
}

export type MappingRefusal =
  "sourceMissing" | "targetMissing" | "otherKind" | "otherScope" | "otherTargetScope"

interface ScopedId {
  readonly elementId: string
  readonly scope: string | undefined
}

export class MigrationElements {
  private readonly sourceNodes: FlowNodes
  private readonly targetNodes: FlowNodes | undefined
  private readonly sourceNames: ReadonlyMap<string, string>
  private readonly targetNames: ReadonlyMap<string, string>

  constructor(sourceXml: string, targetXml: string | undefined) {
    this.sourceNodes = FlowNodes.of(sourceXml)
    this.sourceNames = ElementNames.of(sourceXml)
    this.targetNodes = targetXml === undefined ? undefined : FlowNodes.of(targetXml)
    this.targetNames = targetXml === undefined ? new Map() : ElementNames.of(targetXml)
  }

  mappableSources(): string[] {
    return this.sourceNodes
      .ids()
      .filter((id) => MAPPABLE_KINDS.has(this.sourceNodes.kindOf(id) ?? ""))
  }

  candidatesFor(sourceElementId: string): MappingCandidate[] {
    const kind = this.sourceNodes.kindOf(sourceElementId)
    const target = this.targetNodes
    if (kind === undefined || target === undefined) {
      return []
    }
    return target
      .ids()
      .filter((id) => target.kindOf(id) === kind)
      .map((elementId) => ({ elementId, label: this.targetLabel(elementId) }))
  }

  maps(mapping: ElementPair): boolean {
    return this.candidatesFor(mapping.sourceElementId).some(
      (candidate) => candidate.elementId === mapping.targetElementId,
    )
  }

  refusalOf(mapping: ElementPair): MappingRefusal | undefined {
    return mapping.sourceElementId.includes(SCOPE_MARK)
      ? this.scopeRefusal(mapping)
      : this.pairRefusal(mapping)
  }

  holdsTokens(elementId: string): boolean {
    const kind = this.sourceNodes.kindOf(elementId)
    return kind !== undefined && !this.sourceNodes.isSubProcess(elementId)
  }

  restartingTimerOf(sourceElementId: string): string | undefined {
    if (!this.sourceNodes.hasTimer(sourceElementId)) {
      return undefined
    }
    return this.sourceNodes.attachedTo(sourceElementId)
  }

  hasCallActivity(): boolean {
    return this.sourceNodes.ids().some((id) => this.sourceNodes.kindOf(id) === "callActivity")
  }

  hasCatchingEvents(): boolean {
    return this.sourceNodes
      .ids()
      .some((id) =>
        ["boundaryEvent", "intermediateCatchEvent"].includes(this.sourceNodes.kindOf(id) ?? ""),
      )
  }

  sourceLabel(elementId: string): string {
    return this.sourceNames.get(elementId) ?? elementId
  }

  targetLabel(elementId: string): string {
    return this.targetNames.get(elementId) ?? elementId
  }

  static elementPairOf(mapping: ElementPair): ElementPair {
    if (!mapping.sourceElementId.includes(SCOPE_MARK)) {
      return mapping
    }
    return {
      sourceElementId: MigrationElements.scopedOf(mapping.sourceElementId).elementId,
      targetElementId: MigrationElements.scopedOf(mapping.targetElementId).elementId,
    }
  }

  private static scopedOf(id: string): ScopedId {
    const mark = id.indexOf(SCOPE_MARK)
    return mark < 0
      ? { elementId: id, scope: undefined }
      : { elementId: id.slice(0, mark), scope: id.slice(mark + 1) }
  }

  private scopeRefusal(mapping: ElementPair): MappingRefusal | undefined {
    const source = MigrationElements.scopedOf(mapping.sourceElementId)
    const target = MigrationElements.scopedOf(mapping.targetElementId)
    if (this.sourceNodes.kindOf(source.elementId) === undefined) {
      return "sourceMissing"
    }
    if (!this.sourceNodes.hasOwnLoop(source.elementId)) {
      return "otherScope"
    }
    if (target.scope !== source.scope) {
      return "otherTargetScope"
    }
    return this.pairRefusal(MigrationElements.elementPairOf(mapping))
  }

  private pairRefusal(mapping: ElementPair): MappingRefusal | undefined {
    if (this.sourceNodes.kindOf(mapping.sourceElementId) === undefined) {
      return "sourceMissing"
    }
    if (this.targetNodes?.kindOf(mapping.targetElementId) === undefined) {
      return "targetMissing"
    }
    return this.maps(mapping) ? undefined : "otherKind"
  }
}
