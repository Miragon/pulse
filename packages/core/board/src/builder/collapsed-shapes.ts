import { ElementId } from "@miragon/pulse-engine-core"

const TAG = /<(\/?)(?:[\w-]+:)?(\w+)\b((?:[^>"]|"[^"]*")*)>/g
const ID = /\sid="([^"]+)"/
const BPMN_ELEMENT = /\sbpmnElement="([^"]+)"/
const EXPANDED = /\sisExpanded="true"/
const SUB_PROCESS_KINDS: ReadonlySet<string> = new Set([
  "subProcess",
  "transaction",
  "adHocSubProcess",
])

interface Tag {
  readonly closing: boolean
  readonly kind: string
  readonly attributes: string
}

export class CollapsedShapes {
  private readonly parents = new Map<string, string>()
  private readonly expanded = new Set<string>()
  private readonly open: string[] = []

  static of(xml: string): CollapsedShapes {
    const shapes = new CollapsedShapes()
    for (const [, closing, kind = "", attributes = ""] of xml.matchAll(TAG)) {
      shapes.read({ closing: closing === "/", kind, attributes })
    }
    return shapes
  }

  around(elementId: string): ElementId[] {
    const around: ElementId[] = []
    for (let parent = this.parents.get(elementId); parent !== undefined;) {
      if (!this.expanded.has(parent)) {
        around.push(ElementId(parent))
      }
      parent = this.parents.get(parent)
    }
    return around
  }

  private read(tag: Tag): void {
    const subProcess = SUB_PROCESS_KINDS.has(tag.kind)
    if (tag.closing) {
      if (subProcess) {
        this.open.pop()
      }
      return
    }
    this.note(tag)
    const id = ID.exec(tag.attributes)?.[1] ?? ""
    this.nest(id)
    if (subProcess && !tag.attributes.trimEnd().endsWith("/")) {
      this.open.push(id)
    }
  }

  private note(tag: Tag): void {
    if (tag.kind === "BPMNShape" && EXPANDED.test(tag.attributes)) {
      this.expanded.add(BPMN_ELEMENT.exec(tag.attributes)?.[1] ?? "")
    }
  }

  private nest(id: string): void {
    const parent = this.open.at(-1) ?? ""
    if (id !== "" && parent !== "") {
      this.parents.set(id, parent)
    }
  }
}
