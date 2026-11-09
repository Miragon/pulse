import type { InstanceView } from "../protocol/index.js"

export class InstanceViewElements {
  static nameOf(view: InstanceView, elementId: string): string {
    return view.waitStates.find((row) => row.elementId === elementId)?.elementName ?? elementId
  }
}
