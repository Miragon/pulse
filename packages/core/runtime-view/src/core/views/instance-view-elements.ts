import type { InstanceView } from "../protocol/index.js"
import { ElementNames } from "../bpmn/element-names.js"

export class InstanceViewElements {
  static nameOf(view: InstanceView, elementId: string): string {
    return (
      view.waitStates.find((row) => row.elementId === elementId)?.elementName ??
      view.path.find((row) => row.elementId === elementId)?.elementName ??
      ElementNames.of(view.diagramXml).get(elementId) ??
      elementId
    )
  }
}
