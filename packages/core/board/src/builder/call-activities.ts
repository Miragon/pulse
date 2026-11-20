import { XmlTags } from "./xml-tags.js"

export class CallActivities {
  static found(xml: string): boolean | undefined {
    if (!XmlTags.readable(xml)) {
      return undefined
    }
    return XmlTags.of(xml).some((tag) => tag.name === "callActivity" && !tag.closing)
  }
}
