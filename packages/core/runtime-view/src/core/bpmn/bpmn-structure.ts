const TAG = /<(\/?)(?:[\w-]+:)?(\w+)\b((?:[^>"]|"[^"]*")*)>/g
const ID = /\sid="([^"]+)"/
const SOURCE = /\ssourceRef="([^"]+)"/
const TARGET = /\stargetRef="([^"]+)"/

interface SequenceFlow {
  readonly id: string
  readonly source: string
  readonly target: string
}

export class BpmnStructure {
  private readonly flows: SequenceFlow[] = []
  private callActivities = false

  static of(xml: string): BpmnStructure {
    const structure = new BpmnStructure()
    for (const [, closing, kind = "", attributes = ""] of xml.matchAll(TAG)) {
      if (closing !== "/") {
        structure.note(kind, attributes)
      }
    }
    return structure
  }

  static hasCallActivities(xml: string): boolean {
    return BpmnStructure.of(xml).callActivities
  }

  flowsBetween(sources: ReadonlySet<string>, targets: ReadonlySet<string>): string[] {
    return this.flows
      .filter((flow) => sources.has(flow.source) && targets.has(flow.target))
      .map((flow) => flow.id)
  }

  private note(kind: string, attributes: string): void {
    this.callActivities ||= kind === "callActivity"
    if (kind === "sequenceFlow") {
      this.flows.push({
        id: ID.exec(attributes)?.[1] ?? "",
        source: SOURCE.exec(attributes)?.[1] ?? "",
        target: TARGET.exec(attributes)?.[1] ?? "",
      })
    }
  }
}
