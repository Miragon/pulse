import { ElementId } from "@miragon/pulse-engine-core"
import { type XmlTag, XmlTags } from "./xml-tags.js"

const ID = /\sid="([^"]+)"/
const BPMN_ELEMENT = /\sbpmnElement="([^"]+)"/
const EXPANDED = /\sisExpanded="true"/
const SUB_PROCESS_KINDS: ReadonlySet<string> = new Set([
  "subProcess",
  "transaction",
  "adHocSubProcess",
])

export class CollapsedShapes {
  private readonly parents = new Map<string, string>()
  private readonly expanded = new Set<string>()
  private readonly open: string[] = []

  static of(xml: string): CollapsedShapes {
    const shapes = new CollapsedShapes()
    for (const tag of XmlTags.of(xml)) {
      shapes.read(tag)
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

  private read(tag: XmlTag): void {
    const subProcess = SUB_PROCESS_KINDS.has(tag.name)
    if (tag.closing) {
      if (subProcess) {
        this.open.pop()
      }
      return
    }
    this.note(tag)
    const id = ID.exec(tag.text)?.[1] ?? ""
    this.nest(id)
    if (subProcess && !tag.empty) {
      this.open.push(id)
    }
  }

  private note(tag: XmlTag): void {
    if (tag.name === "BPMNShape" && EXPANDED.test(tag.text)) {
      this.expanded.add(BPMN_ELEMENT.exec(tag.text)?.[1] ?? "")
    }
  }

  private nest(id: string): void {
    const parent = this.open.at(-1) ?? ""
    if (id !== "" && parent !== "") {
      this.parents.set(id, parent)
    }
  }
}
